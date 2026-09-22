import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { consumeVisitCredit, refundPurchasedCredits, releaseVisitCredit, reserveVisitCredit, settlePaymentPurchase } from "../lib/server/credits.ts";

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

test("visit credit reservation is atomic and duplicate approval cannot debit twice", async () => {
  const d1 = new SQLiteD1();
  const now = new Date().toISOString();
  try {
    d1.sqlite.prepare("INSERT INTO credit_accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("account-1", "facility-1", "visitor-1", 1, 0, 1, now, now);
    const input = { accountId: "account-1", appointmentId: "visit-1", actorUserId: "staff-1", reason: "Approved visit." };
    assert.deepEqual(await reserveVisitCredit(d1, input), { creditAccountId: "account-1", appointmentId: "visit-1", created: true });
    assert.deepEqual(await reserveVisitCredit(d1, input), { creditAccountId: "account-1", appointmentId: "visit-1", created: false });
    const account = d1.sqlite.prepare("SELECT available_credits, reserved_credits FROM credit_accounts WHERE id = ?").get("account-1");
    assert.equal(account.available_credits, 0);
    assert.equal(account.reserved_credits, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type = 'RESERVATION'").get("visit-1").count, 1);
    await assert.rejects(reserveVisitCredit(d1, { ...input, appointmentId: "visit-2" }), /INSUFFICIENT_VISIT_CREDITS/);
  } finally { d1.close(); }
});

test("reservation release and consumption keep the account and append-only ledger atomic", async () => {
  const d1 = new SQLiteD1();
  const now = new Date().toISOString();
  try {
    d1.sqlite.prepare("INSERT INTO credit_accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("account-2", "facility-1", "visitor-2", 2, 0, 1, now, now);
    const first = { accountId: "account-2", appointmentId: "visit-release", actorUserId: "staff-1", reason: "Approved visit." };
    await reserveVisitCredit(d1, first);
    d1.sqlite.exec("CREATE TRIGGER fail_credit_balance BEFORE UPDATE ON credit_accounts BEGIN SELECT RAISE(ABORT, 'simulated credit transition failure'); END;");
    await assert.rejects(releaseVisitCredit(d1, first), /simulated credit transition failure/);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE appointment_id = 'visit-release' AND entry_type = 'RESERVATION_RELEASE'").get().count, 0);
    const afterReleaseFailure = d1.sqlite.prepare("SELECT available_credits, reserved_credits FROM credit_accounts WHERE id = 'account-2'").get();
    assert.equal(afterReleaseFailure.available_credits, 1);
    assert.equal(afterReleaseFailure.reserved_credits, 1);
    d1.sqlite.exec("DROP TRIGGER fail_credit_balance");
    assert.deepEqual(await releaseVisitCredit(d1, first), { released: true });
    assert.deepEqual(await releaseVisitCredit(d1, first), { released: false, idempotent: true });

    const second = { accountId: "account-2", appointmentId: "visit-consume", actorUserId: "staff-1", reason: "Approved visit." };
    await reserveVisitCredit(d1, second);
    d1.sqlite.exec("CREATE TRIGGER fail_credit_balance BEFORE UPDATE ON credit_accounts BEGIN SELECT RAISE(ABORT, 'simulated credit transition failure'); END;");
    await assert.rejects(consumeVisitCredit(d1, second), /simulated credit transition failure/);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE appointment_id = 'visit-consume' AND entry_type = 'CONSUMPTION'").get().count, 0);
    d1.sqlite.exec("DROP TRIGGER fail_credit_balance");
    assert.deepEqual(await consumeVisitCredit(d1, second), { consumed: true });
    assert.deepEqual(await consumeVisitCredit(d1, second), { consumed: false, idempotent: true });
    const afterConsumption = d1.sqlite.prepare("SELECT available_credits, reserved_credits FROM credit_accounts WHERE id = 'account-2'").get();
    assert.equal(afterConsumption.available_credits, 1);
    assert.equal(afterConsumption.reserved_credits, 0);
  } finally { d1.close(); }
});
