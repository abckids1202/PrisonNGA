import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { purgeExpiredAuthArtifacts } from "../lib/server/auth/cleanup.ts";

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
  d1.database.exec(`
    CREATE TABLE auth_challenges (id TEXT PRIMARY KEY, expires_at TEXT, consumed_at TEXT);
    CREATE TABLE auth_challenge_delivery_attempts (id TEXT PRIMARY KEY, challenge_id TEXT);
    CREATE TABLE auth_federation_states (id TEXT PRIMARY KEY, expires_at TEXT, consumed_at TEXT);
    CREATE TABLE saml_request_cache (request_id TEXT PRIMARY KEY, created_at TEXT);
    INSERT INTO auth_challenges VALUES ('expired', '2000-01-01T00:00:00.000Z', NULL), ('recent', '2999-01-01T00:00:00.000Z', NULL);
    INSERT INTO auth_challenge_delivery_attempts VALUES ('attempt-expired', 'expired'), ('attempt-recent', 'recent');
    INSERT INTO auth_federation_states VALUES ('expired', '2000-01-01T00:00:00.000Z', NULL), ('recent', '2999-01-01T00:00:00.000Z', NULL);
    INSERT INTO saml_request_cache VALUES ('expired', '2000-01-01T00:00:00.000Z'), ('recent', '2999-01-01T00:00:00.000Z');
  `);
  await purgeExpiredAuthArtifacts(d1);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS count FROM auth_challenges").get().count, 1);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS count FROM auth_challenge_delivery_attempts").get().count, 1);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS count FROM auth_federation_states").get().count, 1);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS count FROM saml_request_cache").get().count, 1);
});
