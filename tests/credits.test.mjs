import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { refundPurchasedCredits, settlePaymentPurchase } from "../lib/server/credits.ts";

class SQLiteD1Statement {
  values = [];

  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async run() {
    const result = this.database.sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
  async first() { return this.database.sqlite.prepare(this.sql).get(...this.values) || null; }
}

class SQLiteD1 {
  sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE credit_accounts (
        id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, user_id TEXT NOT NULL,
        available_credits INTEGER NOT NULL, reserved_credits INTEGER NOT NULL,
        version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(user_id, facility_id)
      );
      CREATE TABLE credit_ledger_entries (
        id TEXT PRIMARY KEY, credit_account_id TEXT NOT NULL, appointment_id TEXT,
        entry_type TEXT NOT NULL, amount INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
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

test("purchase settlement atomically credits once across duplicate webhook deliveries", async () => {
  const d1 = new SQLiteD1();
  try {
    const purchase = { paymentIntentId: "payment-1", facilityId: "facility-1", userId: "visitor-1", amount: 3, reason: "Payment event paid." };
    assert.deepEqual(await settlePaymentPurchase(d1, purchase), { purchased: true, idempotent: false });
    assert.deepEqual(await settlePaymentPurchase(d1, purchase), { purchased: false, idempotent: true });
    const account = d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE user_id = ? AND facility_id = ?").get("visitor-1", "facility-1");
    const ledger = d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE entry_type = 'PURCHASE'").get();
    assert.equal(account.available_credits, 3);
    assert.equal(ledger.count, 1);
  } finally { d1.close(); }
});

test("failed balance update rolls back the purchase ledger so a retry can recover", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("CREATE TRIGGER fail_credit_balance BEFORE UPDATE ON credit_accounts BEGIN SELECT RAISE(ABORT, 'simulated balance write failure'); END;");
    const purchase = { paymentIntentId: "payment-2", facilityId: "facility-1", userId: "visitor-2", amount: 2, reason: "Payment event paid." };
    await assert.rejects(settlePaymentPurchase(d1, purchase), /simulated balance write failure/);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
    d1.sqlite.exec("DROP TRIGGER fail_credit_balance");
    assert.deepEqual(await settlePaymentPurchase(d1, purchase), { purchased: true, idempotent: false });
    assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE user_id = ?").get("visitor-2").available_credits, 2);
  } finally { d1.close(); }
});

test("refund reversal is atomic, idempotent, and refuses to overdraw a credit account", async () => {
  const d1 = new SQLiteD1();
  try {
    await settlePaymentPurchase(d1, { paymentIntentId: "payment-3", facilityId: "facility-1", userId: "visitor-3", amount: 2, reason: "Payment event paid." });
    assert.deepEqual(await refundPurchasedCredits(d1, { paymentIntentId: "payment-3", actorUserId: "system", reason: "Provider refund." }), { refunded: true });
    assert.deepEqual(await refundPurchasedCredits(d1, { paymentIntentId: "payment-3", actorUserId: "system", reason: "Provider refund replay." }), { refunded: false, idempotent: true });
    assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE user_id = ?").get("visitor-3").available_credits, 0);
    await settlePaymentPurchase(d1, { paymentIntentId: "payment-4", facilityId: "facility-1", userId: "visitor-4", amount: 1, reason: "Payment event paid." });
    d1.sqlite.prepare("UPDATE credit_accounts SET available_credits = 0 WHERE user_id = ?").run("visitor-4");
    await assert.rejects(refundPurchasedCredits(d1, { paymentIntentId: "payment-4", actorUserId: "system", reason: "Late refund." }), /CREDIT_REVERSAL_REQUIRES_REVIEW/);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE entry_type = 'REFUND'").get().count, 1);
  } finally { d1.close(); }
});
