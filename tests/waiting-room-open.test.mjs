import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openScheduledWaitingRoomStatements } from "../lib/server/waiting-room-open.ts";

class TestD1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    return {
      bind: (...values) => ({
        run: async () => {
          const result = this.sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      }),
    };
  }
}

function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE waiting_room_sessions (
      appointment_id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, state TEXT NOT NULL,
      visitor_presence TEXT NOT NULL, prisoner_presence TEXT NOT NULL,
      identity_state TEXT NOT NULL, camera_state TEXT NOT NULL, microphone_state TEXT NOT NULL,
      network_state TEXT NOT NULL, room_state TEXT NOT NULL, kiosk_state TEXT NOT NULL,
      restriction_state TEXT NOT NULL, assigned_room_id TEXT, assigned_kiosk_id TEXT,
      version INTEGER NOT NULL, last_checked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE resource_reservations (
      resource_id TEXT, appointment_id TEXT, facility_id TEXT, resource_type TEXT,
      status TEXT, created_at TEXT
    );
    CREATE TABLE audit_events (
      id TEXT, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT,
      entity_type TEXT, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT,
      correlation_id TEXT, request_id TEXT, created_at TEXT
    );
    CREATE TABLE outbox_events (
      id TEXT, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, facility_id TEXT,
      payload TEXT, correlation_id TEXT, created_at TEXT
    );
  `);
  return sqlite;
}

async function executeBatch(sqlite, statements) {
  sqlite.exec("BEGIN");
  try {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    sqlite.exec("COMMIT");
    return results;
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

test("scheduled Waiting Room opening materializes one assigned, audited record", async () => {
  const sqlite = createDatabase();
  sqlite.prepare("INSERT INTO resource_reservations VALUES (?, ?, ?, ?, ?, ?)").run("room-1", "visit-1", "facility-1", "ROOM", "RESERVED", "2026-10-11T10:00:00.000Z");
  sqlite.prepare("INSERT INTO resource_reservations VALUES (?, ?, ?, ?, ?, ?)").run("kiosk-1", "visit-1", "facility-1", "DEVICE", "RESERVED", "2026-10-11T10:00:00.000Z");
  const d1 = new TestD1(sqlite);
  const input = {
    appointmentId: "visit-1", facilityId: "facility-1",
    requestedStart: "2026-10-11T10:10:00.000Z", requestedEnd: "2026-10-11T10:40:00.000Z",
    now: "2026-10-11T10:00:00.000Z", requestId: "req-1", correlationId: "cor-1",
  };

  const first = await executeBatch(sqlite, openScheduledWaitingRoomStatements(d1, input));
  assert.equal(first.every((result) => result.meta.changes === 1), true);
  assert.deepEqual({ ...sqlite.prepare("SELECT state, assigned_room_id, assigned_kiosk_id FROM waiting_room_sessions").get() }, { state: "NOT_ARRIVED", assigned_room_id: "room-1", assigned_kiosk_id: "kiosk-1" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action_type = 'WAITING_ROOM_OPENED'").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE event_type = 'WAITING_ROOM_OPENED'").get().count, 1);

  const replay = await executeBatch(sqlite, openScheduledWaitingRoomStatements(d1, input));
  assert.equal(replay[0].meta.changes, 0);
  assert.equal(replay[1].meta.changes, 0);
  assert.equal(replay[2].meta.changes, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
  sqlite.close();
});
