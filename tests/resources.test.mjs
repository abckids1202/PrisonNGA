import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { allocateVisitResources } from "../lib/server/resources.ts";

class SQLiteD1Statement {
  values = [];
  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async run() {
    const result = this.database.sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
  async all() { return { results: this.database.sqlite.prepare(this.sql).all(...this.values) }; }
}

class SQLiteD1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE resources (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, resource_type TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE resource_reservations (
        id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, appointment_id TEXT NOT NULL,
        resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, status TEXT NOT NULL,
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
  }
  prepare(sql) { return new SQLiteD1Statement(this, sql); }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

function addResource(d1, id, resourceType, displayName, status) {
  d1.sqlite.prepare("INSERT INTO resources VALUES (?, 'facility-1', ?, ?, ?)").run(id, resourceType, displayName, status);
}

test("resource selection and room/device reservations are atomic and idempotent", async () => {
  const d1 = new SQLiteD1();
  try {
    addResource(d1, "room-1", "ROOM", "Room 01", "AVAILABLE");
    addResource(d1, "device-1", "DEVICE", "Kiosk 01", "ONLINE");
    const visit = { facilityId: "facility-1", appointmentId: "visit-1", startsAt: "2026-10-01T09:00:00.000Z", endsAt: "2026-10-01T09:30:00.000Z" };
    const first = await allocateVisitResources(d1, visit);
    assert.equal(first.roomId, "room-1");
    assert.equal(first.deviceId, "device-1");
    assert.equal(first.created, true);

    const replay = await allocateVisitResources(d1, visit);
    assert.equal(replay.roomId, first.roomId);
    assert.equal(replay.deviceId, first.deviceId);
    assert.equal(replay.created, false);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 2);

    await assert.rejects(allocateVisitResources(d1, { ...visit, appointmentId: "visit-2" }), /RESOURCE_RESERVATION_CONFLICT/);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 2, "failed device selection rolls back the room reservation");
  } finally { d1.close(); }
});

test("resource allocation skips conflicting resources and uses another available pair", async () => {
  const d1 = new SQLiteD1();
  try {
    addResource(d1, "room-1", "ROOM", "Room 01", "AVAILABLE");
    addResource(d1, "room-2", "ROOM", "Room 02", "AVAILABLE");
    addResource(d1, "device-1", "DEVICE", "Kiosk 01", "ONLINE");
    addResource(d1, "device-2", "DEVICE", "Kiosk 02", "ONLINE");
    const slot = { facilityId: "facility-1", startsAt: "2026-10-01T09:00:00.000Z", endsAt: "2026-10-01T09:30:00.000Z" };
    await allocateVisitResources(d1, { ...slot, appointmentId: "visit-1" });
    const second = await allocateVisitResources(d1, { ...slot, appointmentId: "visit-2" });
    assert.equal(second.roomId, "room-2");
    assert.equal(second.deviceId, "device-2");
    assert.equal(second.created, true);
  } finally { d1.close(); }
});
