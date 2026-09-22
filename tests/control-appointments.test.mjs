import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { controlAppointmentsStatement } from "../lib/server/control-appointments.ts";

class SqliteStatement {
  values = [];
  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
}

class SqliteD1 {
  database = new DatabaseSync(":memory:");
  prepare(sql) { return new SqliteStatement(this.database, sql); }
  close() { this.database.close(); }
}

function createDatabase() {
  const d1 = new SqliteD1();
  d1.database.exec(`
    CREATE TABLE appointments (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, visitor_user_id TEXT NOT NULL, prisoner_id TEXT NOT NULL, status TEXT NOT NULL, requested_start TEXT NOT NULL, requested_end TEXT NOT NULL, timezone TEXT NOT NULL, appointment_type TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL);
    CREATE TABLE prisoners (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, prisoner_number TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL, visitation_status TEXT NOT NULL);
    CREATE TABLE facilities (id TEXT PRIMARY KEY, current_state TEXT NOT NULL);
    CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, facility_id TEXT NOT NULL, available_credits INTEGER NOT NULL, reserved_credits INTEGER NOT NULL);
    CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, credit_account_id TEXT NOT NULL, appointment_id TEXT NOT NULL, entry_type TEXT NOT NULL);
    CREATE TABLE visitor_relationships (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, prisoner_id TEXT NOT NULL, visitor_user_id TEXT NOT NULL, relationship_type TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE resources (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, resource_type TEXT NOT NULL, display_name TEXT NOT NULL);
    CREATE TABLE resource_reservations (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, appointment_id TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);

    INSERT INTO facilities VALUES ('facility-a', 'NORMAL_OPERATIONS'), ('facility-b', 'LOCKDOWN');
    INSERT INTO users VALUES ('visitor-a', 'Alya Pratama'), ('visitor-b', 'Bima Santoso');
    INSERT INTO prisoners VALUES ('prisoner-a', 'facility-a', 'P-100', 'D. Pratama', 'ACTIVE', 'APPROVED'), ('prisoner-b', 'facility-b', 'P-200', 'R. Santoso', 'ACTIVE', 'APPROVED');
    INSERT INTO credit_accounts VALUES ('credits-a', 'visitor-a', 'facility-a', 2, 1), ('credits-b', 'visitor-b', 'facility-b', 5, 0);
    INSERT INTO appointments VALUES ('visit-a', 'facility-a', 'visitor-a', 'prisoner-a', 'APPROVED', '2026-10-01T02:00:00.000Z', '2026-10-01T02:30:00.000Z', 'Asia/Jakarta', 'FAMILY', 4, 'created', 'updated'), ('visit-b', 'facility-b', 'visitor-b', 'prisoner-b', 'SUBMITTED', '2026-10-01T03:00:00.000Z', '2026-10-01T03:30:00.000Z', 'Asia/Jakarta', 'LEGAL', 2, 'created', 'updated');
    INSERT INTO visitor_relationships VALUES ('relation-a', 'facility-a', 'prisoner-a', 'visitor-a', 'SIBLING', 'APPROVED'), ('relation-b', 'facility-b', 'prisoner-b', 'visitor-b', 'COUNSEL', 'APPROVED');
    INSERT INTO credit_ledger_entries VALUES ('reservation-a', 'credits-a', 'visit-a', 'RESERVATION');
    INSERT INTO resources VALUES ('room-a', 'facility-a', 'ROOM', 'Room 03'), ('device-a', 'facility-a', 'DEVICE', 'Kiosk 04');
    INSERT INTO resource_reservations VALUES ('room-reservation-a', 'facility-a', 'visit-a', 'ROOM', 'room-a', 'RESERVED', 'created'), ('device-reservation-a', 'facility-a', 'visit-a', 'DEVICE', 'device-a', 'RESERVED', 'created');
  `);
  return d1;
}

test("Control appointment query returns facility-scoped, backend-derived review context", async () => {
  const d1 = createDatabase();
  try {
    const result = await controlAppointmentsStatement(d1, "facility-a").all();
    assert.equal(result.results.length, 1);
    assert.deepEqual({ ...result.results[0] }, {
      id: "visit-a",
      visitor_user_id: "visitor-a",
      visitor_name: "Alya Pratama",
      prisoner_id: "prisoner-a",
      prisoner_number: "P-100",
      prisoner_name: "D. Pratama",
      status: "APPROVED",
      requested_start: "2026-10-01T02:00:00.000Z",
      requested_end: "2026-10-01T02:30:00.000Z",
      timezone: "Asia/Jakarta",
      appointment_type: "FAMILY",
      version: 4,
      created_at: "created",
      updated_at: "updated",
      prisoner_status: "ACTIVE",
      visitation_status: "APPROVED",
      facility_state: "NORMAL_OPERATIONS",
      available_credits: 2,
      reserved_credits: 1,
      relationship_type: "SIBLING",
      relationship_status: "APPROVED",
      active_credit_reservation: 1,
      room_name: "Room 03",
      kiosk_name: "Kiosk 04",
    });
  } finally {
    d1.close();
  }
});

test("Control appointment status filtering is bound and remains facility-scoped", async () => {
  const d1 = createDatabase();
  try {
    const result = await controlAppointmentsStatement(d1, "facility-a", "SUBMITTED").all();
    assert.deepEqual(result.results, []);
    const otherFacility = await controlAppointmentsStatement(d1, "facility-b", "SUBMITTED").all();
    assert.deepEqual(otherFacility.results.map((row) => row.id), ["visit-b"]);
  } finally {
    d1.close();
  }
});
