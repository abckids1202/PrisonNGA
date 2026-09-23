import assert from "node:assert/strict";
import test from "node:test";
import { resolveOutboxVisitorRecipient } from "../lib/server/notifications/outbox.ts";

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() { return this.db.lookup(this.sql, this.values); }
}

class FakeD1 {
  constructor() {
    this.rows = {
      appointment: { visitor_user_id: "visitor-appointment" },
      session: { visitor_user_id: "visitor-session" },
      relationship: { visitor_user_id: "visitor-relationship" },
      verification: { visitor_user_id: "visitor-verification" },
      evidence: { visitor_user_id: "visitor-evidence" },
      payment: { visitor_user_id: "visitor-payment" },
    };
  }
  prepare(sql) { return new FakeStatement(this, sql); }
  lookup(sql, [aggregateId, facilityId]) {
    if (facilityId !== "facility-1") return null;
    if (sql.includes("FROM appointments")) return aggregateId === "appointment-1" ? this.rows.appointment : null;
    if (sql.includes("FROM visit_sessions")) return aggregateId === "session-1" ? this.rows.session : null;
    if (sql.includes("FROM visitor_relationships")) return aggregateId === "relationship-1" ? this.rows.relationship : null;
    if (sql.includes("FROM verification_cases")) return aggregateId === "verification-1" ? this.rows.verification : null;
    if (sql.includes("FROM evidence_documents")) return aggregateId === "evidence-1" ? this.rows.evidence : null;
    if (sql.includes("FROM payment_intents")) return aggregateId === "payment-1" ? this.rows.payment : null;
    return null;
  }
}

test("outbox recipient resolution is facility-scoped for visitor aggregates", async () => {
  const db = new FakeD1();
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "appointment", aggregate_id: "appointment-1", facility_id: "facility-1" }), "visitor-appointment");
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "visit_session", aggregate_id: "session-1", facility_id: "facility-1" }), "visitor-session");
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "visitor_relationship", aggregate_id: "relationship-1", facility_id: "facility-1" }), "visitor-relationship");
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "verification_case", aggregate_id: "verification-1", facility_id: "facility-1" }), "visitor-verification");
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "evidence_document", aggregate_id: "evidence-1", facility_id: "facility-1" }), "visitor-evidence");
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "payment_intent", aggregate_id: "payment-1", facility_id: "facility-1" }), "visitor-payment");
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "appointment", aggregate_id: "appointment-1", facility_id: "facility-2" }), null);
});

test("non-visitor aggregates and incomplete rows do not create a recipient", async () => {
  const db = new FakeD1();
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "incident", aggregate_id: "incident-1", facility_id: "facility-1" }), null);
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "appointment", aggregate_id: null, facility_id: "facility-1" }), null);
  assert.equal(await resolveOutboxVisitorRecipient(db, { aggregate_type: "appointment", aggregate_id: "appointment-1", facility_id: null }), null);
});
