import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { financeLedgerStatement, financePaymentsStatement, financeSummaryStatement } from "../lib/server/finance-directory.ts";

class Statement {
  values = [];
  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
}
class D1 {
  database = new DatabaseSync(":memory:");
  prepare(sql) { return new Statement(this.database, sql); }
  close() { this.database.close(); }
}

function seeded() {
  const d1 = new D1();
  d1.database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL);
    CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, facility_id TEXT, user_id TEXT, reserved_credits INTEGER);
    CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, credit_account_id TEXT, appointment_id TEXT, entry_type TEXT, amount INTEGER, reason TEXT, created_at TEXT);
    CREATE TABLE payment_intents (id TEXT PRIMARY KEY, facility_id TEXT, user_id TEXT, provider TEXT, credit_quantity INTEGER, amount_minor INTEGER, currency TEXT, status TEXT, provider_reference TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO users VALUES ('visitor-a', 'Alya Pratama'), ('visitor-b', 'Other Facility');
    INSERT INTO credit_accounts VALUES ('credits-a', 'facility-a', 'visitor-a', 1), ('credits-b', 'facility-b', 'visitor-b', 4);
    INSERT INTO credit_ledger_entries VALUES ('entry-1', 'credits-a', NULL, 'PURCHASE', 3, 'Payment settled', '2026-09-23T01:00:00.000Z'), ('entry-2', 'credits-a', 'visit-a', 'RESERVATION', -1, 'Appointment approved', '2026-09-23T02:00:00.000Z'), ('entry-3', 'credits-a', 'visit-old', 'CONSUMPTION', 0, 'Visit completed', '2026-09-22T02:00:00.000Z'), ('entry-4', 'credits-b', NULL, 'PURCHASE', 99, 'Other facility', '2026-09-23T03:00:00.000Z');
    INSERT INTO payment_intents VALUES ('payment-1', 'facility-a', 'visitor-a', 'sandbox', 3, 150000, 'IDR', 'SUCCEEDED', 'provider-1', '2026-09-23T01:00:00.000Z', '2026-09-23T01:00:00.000Z'), ('payment-2', 'facility-a', 'visitor-a', 'sandbox', 1, 50000, 'IDR', 'REFUNDED', 'provider-2', '2026-09-22T01:00:00.000Z', '2026-09-22T01:00:00.000Z'), ('payment-3', 'facility-b', 'visitor-b', 'sandbox', 99, 1, 'IDR', 'SUCCEEDED', 'provider-3', '2026-09-23T04:00:00.000Z', '2026-09-23T04:00:00.000Z');
  `);
  return d1;
}

test("finance summary and records stay facility-scoped and derive from the append-only sources", async () => {
  const d1 = seeded();
  try {
    const summary = await financeSummaryStatement(d1, "facility-a").first();
    assert.deepEqual({ ...summary }, { credits_purchased: 3, credits_consumed: 0, credits_reserved: 1, refund_cases: 1, pending_payments: 0, settled_amount_minor: 150000, last_ledger_activity: "2026-09-23T02:00:00.000Z" });
    const ledger = await financeLedgerStatement(d1, "facility-a").all();
    assert.equal(ledger.results.length, 3);
    assert.ok(ledger.results.every((row) => row.visitor_name === "Alya Pratama"));
    const payments = await financePaymentsStatement(d1, "facility-a").all();
    assert.equal(payments.results.length, 2);
    assert.ok(payments.results.every((row) => row.visitor_name === "Alya Pratama"));
  } finally {
    d1.close();
  }
});
