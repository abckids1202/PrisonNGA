import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { purgeExpiredAuthArtifacts, purgeExpiredAuthSessions } from "../lib/server/auth/cleanup.ts";

class Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; }
  async run() { const result = this.database.prepare(this.sql).run(); return { meta: { changes: Number(result.changes) } }; }
}

class D1 {
  database = new DatabaseSync(":memory:");
  prepare(sql) { return new Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec("COMMIT"); return results; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}

test("expired authentication artifacts are purged while recent state remains", async () => {
  const d1 = new D1();
  const expired = new Date(Date.now() - 60_000).toISOString();
  const expiredDay = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
  const recent = new Date(Date.now() + 60 * 60_000).toISOString();
  d1.database.exec(`
    CREATE TABLE auth_challenges (id TEXT PRIMARY KEY, expires_at TEXT, consumed_at TEXT);
    CREATE TABLE auth_challenge_delivery_attempts (id TEXT PRIMARY KEY, challenge_id TEXT);
    CREATE TABLE auth_federation_states (id TEXT PRIMARY KEY, expires_at TEXT, consumed_at TEXT);
    CREATE TABLE saml_request_cache (request_id TEXT PRIMARY KEY, created_at TEXT);
    INSERT INTO auth_challenges VALUES ('expired', '${expired}', NULL), ('recent', '${recent}', NULL);
    INSERT INTO auth_challenge_delivery_attempts VALUES ('attempt-expired', 'expired'), ('attempt-recent', 'recent');
    INSERT INTO auth_federation_states VALUES ('expired', '${expired}', NULL), ('recent', '${recent}', NULL);
    INSERT INTO saml_request_cache VALUES ('expired', '${expiredDay}'), ('recent', '${recent}');
  `);
  await purgeExpiredAuthArtifacts(d1);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS count FROM auth_challenges").get().count, 1);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS count FROM auth_challenge_delivery_attempts").get().count, 1);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS count FROM auth_federation_states").get().count, 1);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS count FROM saml_request_cache").get().count, 1);
});

test("expired sessions are purged while active and recently revoked sessions remain", async () => {
  const d1 = new D1();
  const expired = new Date(Date.now() - 60_000).toISOString();
  const oldRevocation = new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString();
  const recentRevocation = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  d1.database.exec(`
    CREATE TABLE auth_sessions (id TEXT PRIMARY KEY, expires_at TEXT, revoked_at TEXT);
    INSERT INTO auth_sessions VALUES ('expired', '${expired}', NULL), ('old-revoked', '${future}', '${oldRevocation}'), ('recent-revoked', '${future}', '${recentRevocation}'), ('active', '${future}', NULL);
  `);
  await purgeExpiredAuthSessions(d1);
  assert.deepEqual(d1.database.prepare("SELECT id FROM auth_sessions ORDER BY id").all().map((row) => row.id), ["active", "recent-revoked"]);
});
