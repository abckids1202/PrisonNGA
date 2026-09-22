import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createSamlClientOptions, D1SamlCacheProvider, SAML_REQUEST_CACHE_TTL_MS } from "../lib/server/auth/saml.ts";
import { ValidateInResponseTo } from "@node-saml/node-saml";

class SQLiteD1Statement {
  values = [];
  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async run() { const result = this.database.sqlite.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
  async first() { return this.database.sqlite.prepare(this.sql).get(...this.values) || null; }
}

class SQLiteD1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() { this.sqlite.exec("CREATE TABLE saml_request_cache (request_id TEXT PRIMARY KEY, issue_instant TEXT NOT NULL, created_at TEXT NOT NULL, state_hash TEXT NOT NULL)"); }
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

const samlConfig = {
  entityId: "https://securevisit.example/saml",
  metadataUrl: "https://idp.example/metadata",
  entryPoint: "https://idp.example/sso",
  idpCert: "test-certificate",
  callbackUri: "https://securevisit.example/api/auth/staff/saml/callback",
};

test("SAML client requires a correlated response and uses the shared D1 cache", () => {
  const database = new SQLiteD1();
  try {
    const options = createSamlClientOptions(samlConfig, database, "state-hash-1");
    assert.equal(options.validateInResponseTo, ValidateInResponseTo.always);
    assert.equal(options.requestIdExpirationPeriodMs, SAML_REQUEST_CACHE_TTL_MS);
    assert.ok(options.cacheProvider instanceof D1SamlCacheProvider);
  } finally {
    database.close();
  }
});

test("SAML request IDs are available across cache-provider instances and become single-use", async () => {
  const database = new SQLiteD1();
  try {
    const issuer = new D1SamlCacheProvider(database, "state-hash-1");
    const callback = new D1SamlCacheProvider(database, "state-hash-1");
    const unrelatedCallback = new D1SamlCacheProvider(database, "state-hash-2");
    const created = await issuer.saveAsync("_request-1", "2026-09-22T09:00:00.000Z");
    assert.equal(created?.value, "2026-09-22T09:00:00.000Z");
    assert.equal(typeof created?.createdAt, "number");
    assert.equal(await unrelatedCallback.getAsync("_request-1"), null);
    assert.equal(await unrelatedCallback.removeAsync("_request-1"), null);
    assert.equal(await callback.getAsync("_request-1"), "2026-09-22T09:00:00.000Z");
    assert.equal(await callback.removeAsync("_request-1"), "_request-1");
    assert.equal(await issuer.getAsync("_request-1"), null);
    assert.equal(await issuer.removeAsync("_request-1"), null);
  } finally {
    database.close();
  }
});

test("SAML request IDs cannot be overwritten and expired IDs are rejected", async () => {
  const database = new SQLiteD1();
  try {
    const cache = new D1SamlCacheProvider(database, "state-hash-1", 1000);
    assert.ok(await cache.saveAsync("_request-1", "first"));
    assert.equal(await cache.saveAsync("_request-1", "replacement"), null);
    assert.equal(await cache.getAsync("_request-1"), "first");
    database.sqlite.prepare("UPDATE saml_request_cache SET created_at = ? WHERE request_id = ?")
      .run(new Date(Date.now() - 2000).toISOString(), "_request-1");
    assert.equal(await cache.getAsync("_request-1"), null);
    assert.equal(database.sqlite.prepare("SELECT request_id FROM saml_request_cache WHERE request_id = ?").get("_request-1"), undefined);
  } finally {
    database.close();
  }
});
