import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { financeReconciliationStatement } from "../lib/server/finance-directory.ts";

class D1Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
}

class D1 {
  database = new DatabaseSync(":memory:");
  prepare(sql) { return new D1Statement(this.database, sql); }
}

test("finance reconciliation detects facility-scoped payment and provider-event gaps", async () => {
  const d1 = new D1();
  d1.database.exec(`
    CREATE TABLE payment_intents (id TEXT PRIMARY KEY, facility_id TEXT, status TEXT);
    CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, facility_id TEXT);
    CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, credit_account_id TEXT, idempotency_key TEXT);
    CREATE TABLE payment_provider_events (id TEXT PRIMARY KEY, payload TEXT, status TEXT);
    CREATE TABLE payment_refund_requests (id TEXT PRIMARY KEY, payment_intent_id TEXT, facility_id TEXT, status TEXT);
    INSERT INTO payment_intents VALUES ('payment-1', 'facility-1', 'SUCCEEDED');
    INSERT INTO payment_intents VALUES ('payment-2', 'facility-2', 'SUCCEEDED');
    INSERT INTO payment_provider_events VALUES ('event-1', '{"paymentIntentId":"payment-1"}', 'RECEIVED');
    INSERT INTO payment_provider_events VALUES ('event-2', '{"paymentIntentId":"payment-2"}', 'RECEIVED');
  `);
  const result = await financeReconciliationStatement(d1, "facility-1").all();
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results.map((row) => row.issue_type).sort(), ["PAYMENT_WITHOUT_PURCHASE", "RECEIVED_PROVIDER_EVENT"]);
  assert.ok(result.results.every((row) => row.payment_intent_id === "payment-1"));
});
