import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { peopleDirectoryCountsStatement, pendingRelationshipDirectoryStatement, visitorDirectoryStatement } from "../lib/server/people-directory.ts";

class SqliteStatement {
  values = [];
  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
}

class SqliteD1 {
  database = new DatabaseSync(":memory:");
  prepare(sql) { return new SqliteStatement(this.database, sql); }
  close() { this.database.close(); }
}

function seededDirectory() {
  const d1 = new SqliteD1();
  d1.database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, external_id TEXT, display_name TEXT, user_type TEXT, status TEXT);
    CREATE TABLE visitor_profiles (user_id TEXT PRIMARY KEY, legal_name TEXT, preferred_name TEXT, profile_status TEXT);
    CREATE TABLE visitor_relationships (id TEXT PRIMARY KEY, facility_id TEXT, visitor_user_id TEXT, prisoner_id TEXT, relationship_type TEXT, status TEXT, updated_at TEXT, created_at TEXT);
    CREATE TABLE prisoners (id TEXT PRIMARY KEY, facility_id TEXT, display_name TEXT);
    CREATE TABLE verification_cases (id TEXT PRIMARY KEY, facility_id TEXT, relationship_id TEXT, status TEXT, submitted_at TEXT);
    CREATE TABLE appointments (id TEXT PRIMARY KEY, facility_id TEXT, visitor_user_id TEXT, status TEXT, requested_start TEXT);
    CREATE TABLE resource_reservations (id TEXT PRIMARY KEY, facility_id TEXT, appointment_id TEXT, resource_type TEXT, resource_id TEXT, status TEXT);
    CREATE TABLE resources (id TEXT PRIMARY KEY, facility_id TEXT, display_name TEXT);
    CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, user_id TEXT, facility_id TEXT, available_credits INTEGER, reserved_credits INTEGER);
    INSERT INTO users VALUES ('visitor-a', 'VIS-A', 'User A', 'VISITOR', 'ACTIVE'), ('visitor-b', 'VIS-B', 'User B', 'VISITOR', 'ACTIVE'), ('visitor-c', 'VIS-C', 'User C', 'VISITOR', 'ACTIVE');
    INSERT INTO visitor_profiles VALUES ('visitor-a', 'Alya Pratama', 'Alya', 'ACTIVE'), ('visitor-b', 'Bima Santoso', NULL, 'ACTIVE'), ('visitor-c', 'Casey Other', NULL, 'ACTIVE');
    INSERT INTO prisoners VALUES ('prisoner-a', 'facility-a', 'D. Pratama'), ('prisoner-b', 'facility-b', 'R. Santoso');
    INSERT INTO visitor_relationships VALUES ('relation-a', 'facility-a', 'visitor-a', 'prisoner-a', 'SIBLING', 'APPROVED', '2026-09-20', '2026-09-20'), ('relation-b', 'facility-b', 'visitor-b', 'prisoner-b', 'SPOUSE', 'APPROVED', '2026-09-20', '2026-09-20'), ('relation-c', 'facility-a', 'visitor-a', 'prisoner-a', 'SIBLING', 'PENDING', '2026-09-21', '2026-09-21');
    INSERT INTO verification_cases VALUES ('case-a', 'facility-a', 'relation-a', 'APPROVED', '2026-09-20');
    INSERT INTO appointments VALUES ('visit-a', 'facility-a', 'visitor-a', 'APPROVED', '2026-09-23T03:00:00.000Z'), ('visit-old', 'facility-a', 'visitor-a', 'COMPLETED', '2026-09-01T03:00:00.000Z'), ('visit-b', 'facility-b', 'visitor-b', 'APPROVED', '2026-09-23T03:00:00.000Z');
    INSERT INTO resources VALUES ('room-a', 'facility-a', 'Room 03');
    INSERT INTO resource_reservations VALUES ('reservation-a', 'facility-a', 'visit-a', 'ROOM', 'room-a', 'RESERVED');
    INSERT INTO credit_accounts VALUES ('credits-a', 'visitor-a', 'facility-a', 2, 1), ('credits-b', 'visitor-a', 'facility-b', 9, 0);
  `);
  return d1;
}

test("visitor directory is scoped to facility relationships and derives current operational context", async () => {
  const d1 = seededDirectory();
  try {
    const result = await visitorDirectoryStatement(d1, "facility-a", "2026-09-22T00:00:00.000Z").all();
    assert.equal(result.results.length, 1);
    assert.deepEqual({ ...result.results[0] }, {
      visitor_user_id: "visitor-a",
      visitor_reference: "VIS-A",
      display_name: "Alya",
      account_status: "ACTIVE",
      profile_status: "ACTIVE",
      relationship_type: "SIBLING",
      relationship_status: "PENDING",
      prisoner_name: "D. Pratama",
      verification_status: "APPROVED",
      next_appointment_id: "visit-a",
      next_visit_at: "2026-09-23T03:00:00.000Z",
      next_room: "Room 03",
    });
  } finally {
    d1.close();
  }
});

test("visitor directory excludes visitors unrelated to the selected facility", async () => {
  const d1 = seededDirectory();
  try {
    const result = await visitorDirectoryStatement(d1, "facility-c", "2026-09-22T00:00:00.000Z").all();
    assert.deepEqual(result.results, []);
  } finally {
    d1.close();
  }
});

test("directory summary counts are facility-scoped and not limited by the displayed page cap", async () => {
  const d1 = seededDirectory();
  try {
    const result = await peopleDirectoryCountsStatement(d1, "facility-a").first();
    assert.deepEqual({ ...result }, {
      visitors: 1,
      prisoners: 1,
      awaiting_verification: 0,
      relationship_requests: 1,
    });
  } finally {
    d1.close();
  }
});

test("pending relationship directory returns each facility-scoped request without leaking other facilities", async () => {
  const d1 = seededDirectory();
  try {
    const result = await pendingRelationshipDirectoryStatement(d1, "facility-a").all();
    assert.equal(result.results.length, 1);
    assert.deepEqual({ ...result.results[0] }, {
      relationship_id: "relation-c",
      visitor_user_id: "visitor-a",
      visitor_reference: "VIS-A",
      visitor_name: "Alya",
      prisoner_name: "D. Pratama",
      relationship_type: "SIBLING",
      relationship_status: "PENDING",
      verification_status: null,
    });
  } finally {
    d1.close();
  }
});
