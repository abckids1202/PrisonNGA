import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  authenticateKiosk,
  createKioskCredentialSecret,
  hashKioskCredential,
} from "../lib/server/kiosk-credentials.ts";

class SQLiteD1Statement {
  values = [];
  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async first() { return this.database.sqlite.prepare(this.sql).get(...this.values) || null; }
  async run() { const result = this.database.sqlite.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
}

class SQLiteD1 {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql) { return new SQLiteD1Statement(this, sql); }
  close() { this.sqlite.close(); }
}

async function seedCredential(database, { resourceId = "kiosk-02", status = "ONLINE", credentialStatus = "ACTIVE" } = {}) {
  database.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, resource_type TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kiosk_credentials (
      id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      credential_hash TEXT NOT NULL, status TEXT NOT NULL, last_used_at TEXT
    );
  `);
  const secret = createKioskCredentialSecret();
  database.sqlite.prepare("INSERT OR REPLACE INTO resources VALUES (?, 'facility-1', 'DEVICE', ?)").run(resourceId, status);
  database.sqlite.prepare("INSERT INTO kiosk_credentials (id, facility_id, resource_id, credential_hash, status) VALUES ('credential-1', 'facility-1', ?, ?, ?)")
    .run(resourceId, await hashKioskCredential(secret), credentialStatus);
  return secret;
}

function kioskRequest(resourceId, secret) {
  return new Request("https://securevisit.example/api/kiosk/live-session", {
    method: "POST",
    headers: {
      "x-securevisit-kiosk-id": resourceId,
      ...(secret ? { "x-securevisit-kiosk-token": secret } : {}),
    },
  });
}

test("kiosk device credentials are high-entropy URL-safe secrets and persist only as hashes", async () => {
  const first = createKioskCredentialSecret();
  const second = createKioskCredentialSecret();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first, second);
  assert.notEqual(await hashKioskCredential(first), first);
  assert.match(await hashKioskCredential(first), /^[a-f0-9]{64}$/u);
});

test("authenticates an active credential for its online registered device", async () => {
  const database = new SQLiteD1();
  try {
    const secret = await seedCredential(database);
    const result = await authenticateKiosk(database, kioskRequest("kiosk-02", secret));
    assert.deepEqual(result, { resourceId: "kiosk-02", facilityId: "facility-1" });
    const row = database.sqlite.prepare("SELECT last_used_at, credential_hash FROM kiosk_credentials WHERE id = 'credential-1'").get();
    assert.ok(row.last_used_at);
    assert.notEqual(row.credential_hash, secret);
  } finally { database.close(); }
});

test("kiosk ID alone, a wrong token, a revoked token, and an offline kiosk are rejected", async (t) => {
  await t.test("ID alone", async () => {
    const database = new SQLiteD1();
    try { await seedCredential(database); assert.equal(await authenticateKiosk(database, kioskRequest("kiosk-02")), null); }
    finally { database.close(); }
  });
  await t.test("wrong token", async () => {
    const database = new SQLiteD1();
    try { await seedCredential(database); assert.equal(await authenticateKiosk(database, kioskRequest("kiosk-02", createKioskCredentialSecret())), null); }
    finally { database.close(); }
  });
  await t.test("revoked token", async () => {
    const database = new SQLiteD1();
    try { const secret = await seedCredential(database, { credentialStatus: "REVOKED" }); assert.equal(await authenticateKiosk(database, kioskRequest("kiosk-02", secret)), null); }
    finally { database.close(); }
  });
  await t.test("offline device", async () => {
    const database = new SQLiteD1();
    try { const secret = await seedCredential(database, { status: "OFFLINE" }); assert.equal(await authenticateKiosk(database, kioskRequest("kiosk-02", secret)), null); }
    finally { database.close(); }
  });
});

test("a credential cannot be replayed as another kiosk identity", async () => {
  const database = new SQLiteD1();
  try {
    const secret = await seedCredential(database);
    assert.equal(await authenticateKiosk(database, kioskRequest("kiosk-04", secret)), null);
  } finally { database.close(); }
});
