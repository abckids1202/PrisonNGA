import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { processPaymentProviderEvent } from "../lib/server/payments/process-event.ts";

class D1 {
  sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE payment_intents (id TEXT PRIMARY KEY, facility_id TEXT, user_id TEXT, provider TEXT, credit_quantity INTEGER, amount_minor INTEGER, currency TEXT, status TEXT, version INTEGER, provider_reference TEXT, updated_at TEXT);
      CREATE TABLE payment_provider_events (id TEXT PRIMARY KEY, provider TEXT, event_key TEXT, status TEXT, processed_at TEXT, last_error TEXT);
      CREATE TABLE payment_refund_requests (id TEXT PRIMARY KEY, payment_intent_id TEXT, provider_reference TEXT, status TEXT, updated_at TEXT);
      CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, facility_id TEXT, user_id TEXT, available_credits INTEGER, reserved_credits INTEGER, version INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, credit_account_id TEXT, appointment_id TEXT, entry_type TEXT, amount INTEGER, idempotency_key TEXT UNIQUE, reason TEXT, created_by TEXT, created_at TEXT);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT, request_id TEXT, created_at TEXT);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, facility_id TEXT, payload TEXT, correlation_id TEXT, created_at TEXT);
      INSERT INTO payment_intents VALUES ('payment-1', 'facility-1', 'visitor-1', 'webhook', 2, 100000, 'IDR', 'CHECKOUT_CREATED', 1, 'provider-1', 'before');
      INSERT INTO payment_provider_events VALUES ('event-row', 'webhook', 'event-1', 'PROCESSING', NULL, NULL);
    `);
  }

  prepare(sql) {
    const sqlite = this.sqlite;
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
    };
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const event = { eventType: "PAYMENT_SUCCEEDED", eventId: "event-1", paymentIntentId: "payment-1", providerReference: "provider-1", status: "SUCCEEDED", amountMinor: 100000, currency: "IDR" };

test("payment settlement rejects a provider reference mismatch before writing credits", async () => {
  const d1 = new D1();
  await assert.rejects(processPaymentProviderEvent(d1, { provider: "webhook", eventKey: "event-1", payload: { ...event, providerReference: "other-provider" } }), /PAYMENT_PROVIDER_REFERENCE_MISMATCH/);
  assert.equal(d1.sqlite.prepare("SELECT status FROM payment_intents WHERE id = 'payment-1'").get().status, "CHECKOUT_CREATED");
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
});

test("payment settlement rejects an amount or currency mismatch before writing credits", async () => {
  const d1 = new D1();
  await assert.rejects(processPaymentProviderEvent(d1, { provider: "webhook", eventKey: "event-1", payload: { ...event, amountMinor: 1 } }), /PAYMENT_AMOUNT_MISMATCH/);
  const second = new D1();
  await assert.rejects(processPaymentProviderEvent(second, { provider: "webhook", eventKey: "event-1", payload: { ...event, currency: "USD" } }), /PAYMENT_CURRENCY_MISMATCH/);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
  assert.equal(second.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
});

test("payment success commits provider status, credit purchase, event, audit, and outbox together", async () => {
  const d1 = new D1();
  await processPaymentProviderEvent(d1, { provider: "webhook", eventKey: "event-1", payload: event });
  assert.equal(d1.sqlite.prepare("SELECT status FROM payment_intents WHERE id = 'payment-1'").get().status, "SUCCEEDED");
  assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE user_id = 'visitor-1'").get().available_credits, 2);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE entry_type = 'PURCHASE'").get().count, 1);
  assert.equal(d1.sqlite.prepare("SELECT status FROM payment_provider_events WHERE event_key = 'event-1'").get().status, "PROCESSED");
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
});

test("payment success rolls back credits and status when audit persistence fails", async () => {
  const d1 = new D1();
  d1.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  await assert.rejects(processPaymentProviderEvent(d1, { provider: "webhook", eventKey: "event-1", payload: event }), /audit unavailable/);
  assert.equal(d1.sqlite.prepare("SELECT status FROM payment_intents WHERE id = 'payment-1'").get().status, "CHECKOUT_CREATED");
  assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE user_id = 'visitor-1'").get().available_credits, 0);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
  assert.equal(d1.sqlite.prepare("SELECT status FROM payment_provider_events WHERE event_key = 'event-1'").get().status, "PROCESSING");
});

test("payment refund rolls back the refund ledger and intent status when audit persistence fails", async () => {
  const d1 = new D1();
  d1.sqlite.exec(`
    UPDATE payment_intents SET status = 'SUCCEEDED', version = 2;
    INSERT INTO credit_accounts VALUES ('account-1', 'facility-1', 'visitor-1', 2, 0, 2, 'before', 'before');
    INSERT INTO credit_ledger_entries VALUES ('purchase-1', 'account-1', NULL, 'PURCHASE', 2, 'payment:payment-1:purchase', 'paid', 'system:payment-webhook', 'before');
    UPDATE payment_provider_events SET event_key = 'refund-1', status = 'PROCESSING';
  `);
  d1.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  await assert.rejects(processPaymentProviderEvent(d1, {
    provider: "webhook",
    eventKey: "refund-1",
    payload: { eventType: "PAYMENT_REFUNDED", eventId: "refund-1", paymentIntentId: "payment-1", providerReference: "provider-1", status: "REFUNDED" },
  }), /audit unavailable/);
  assert.equal(d1.sqlite.prepare("SELECT status FROM payment_intents WHERE id = 'payment-1'").get().status, "SUCCEEDED");
  assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE id = 'account-1'").get().available_credits, 2);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE entry_type = 'REFUND'").get().count, 0);
});

test("stale failure events are ignored after a payment has succeeded", async () => {
  const d1 = new D1();
  await processPaymentProviderEvent(d1, { provider: "webhook", eventKey: "event-1", payload: event });
  d1.sqlite.exec("UPDATE payment_provider_events SET event_key = 'failed-1', status = 'PROCESSING'");
  const result = await processPaymentProviderEvent(d1, {
    provider: "webhook",
    eventKey: "failed-1",
    payload: { eventType: "PAYMENT_EXPIRED", eventId: "failed-1", paymentIntentId: "payment-1", providerReference: "provider-1", status: "EXPIRED" },
  });
  assert.equal(result.ignored, "PAYMENT_INTENT_STATE_CHANGED");
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(d1.sqlite.prepare("SELECT status FROM payment_intents WHERE id = 'payment-1'").get().status, "SUCCEEDED");
  assert.equal(d1.sqlite.prepare("SELECT status FROM payment_provider_events WHERE event_key = 'failed-1'").get().status, "IGNORED");
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
});
