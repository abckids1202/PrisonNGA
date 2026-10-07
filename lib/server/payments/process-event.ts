import { ensureCreditAccount, refundPurchasedCreditsStatements, settlePaymentPurchaseStatements } from "../credits";
import { SecurityError } from "../security";
import { auditAndOutboxStatements } from "../events";
import type { PaymentWebhook } from "./provider";

const successfulEvents = new Set(["PAYMENT_SUCCEEDED", "PAYMENT_PAID", "PAYMENT_SUCCESS", "SUCCEEDED", "PAID"]);
const failedEvents = new Set(["PAYMENT_FAILED", "PAYMENT_EXPIRED", "PAYMENT_REFUNDED", "PAYMENT_DISPUTED", "FAILED", "EXPIRED", "REFUNDED", "DISPUTED"]);

function paymentEventTrail(d1: D1Database, input: { intentId: string; facilityId: string; userId: string; eventKey: string; status: string; eventType: string; correlationId: string }) {
  return auditAndOutboxStatements(d1, {
    actorUserId: "system:payment-webhook",
    actorRole: "PAYMENT_PROVIDER",
    facilityId: input.facilityId,
    actionType: "PAYMENT_STATUS_UPDATED",
    entityType: "payment_intent",
    entityId: input.intentId,
    reason: `Payment provider event ${input.eventKey} processed.`,
    newValues: { status: input.status, providerEventType: input.eventType, providerEventKey: input.eventKey },
    requestId: input.eventKey,
    correlationId: input.correlationId,
    eventType: "PAYMENT_STATUS_UPDATED",
    payload: { paymentIntentId: input.intentId, visitorUserId: input.userId, status: input.status, providerEventType: input.eventType },
  }, { sql: "changes() > 0", values: [] });
}

function paymentEventEvidenceGuard(input: { intentId: string; correlationId: string; facilityId?: string; userId?: string; ledgerKey?: string; accountId?: string }) {
  const clauses = [
    "EXISTS (SELECT 1 FROM audit_events WHERE correlation_id = ? AND action_type = 'PAYMENT_STATUS_UPDATED' AND entity_type = 'payment_intent' AND entity_id = ?)",
    "EXISTS (SELECT 1 FROM outbox_events WHERE correlation_id = ? AND event_type = 'PAYMENT_STATUS_UPDATED' AND aggregate_type = 'payment_intent' AND aggregate_id = ?)",
  ];
  const values: unknown[] = [input.correlationId, input.intentId, input.correlationId, input.intentId];
  if (input.ledgerKey && input.accountId && input.facilityId && input.userId) {
    clauses.push("EXISTS (SELECT 1 FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id AND ca.id = ? AND ca.facility_id = ? AND ca.user_id = ? WHERE cle.idempotency_key = ?)");
    values.push(input.accountId, input.facilityId, input.userId, input.ledgerKey);
    // The ledger and denormalized balance must agree before the provider event
    // can become terminal. This catches a silent balance-write omission even
    // when the ledger insert itself succeeded.
    clauses.push("(SELECT COALESCE(SUM(cle.amount), 0) FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id AND ca.id = ? AND ca.facility_id = ? AND ca.user_id = ?) = (SELECT available_credits FROM credit_accounts WHERE id = ? AND facility_id = ? AND user_id = ?)");
    values.push(input.accountId, input.facilityId, input.userId, input.accountId, input.facilityId, input.userId);
  }
  return { sql: clauses.join(" AND "), values };
}

export async function processPaymentProviderEvent(d1: D1Database, input: { provider: string; eventKey: string; payload: PaymentWebhook }): Promise<{ status: string; paymentIntentId?: string; ignored?: string }> {
  const { provider, eventKey, payload } = input;
  const correlationId = crypto.randomUUID();
  // Prefer the immutable SecureVisit payment-intent ID when the adapter
  // supplies it. An OR lookup could select a different intent when a
  // malformed payload contained identifiers belonging to two records.
  const lookupField = payload.paymentIntentId ? "id" : "provider_reference";
  const lookupValue = payload.paymentIntentId || payload.providerReference || "";
  const intent = await d1.prepare(`SELECT pi.id, pi.facility_id, pi.user_id, pi.provider, pi.provider_reference, pi.credit_quantity, pi.amount_minor, pi.currency, pi.status, pi.version FROM payment_intents pi INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR' WHERE pi.provider = ? AND pi.${lookupField} = ? LIMIT 1`).bind(provider, lookupValue).first<{ id: string; facility_id: string; user_id: string; provider: string; provider_reference: string | null; credit_quantity: number; amount_minor: number; currency: string; status: string; version: number }>();
  const now = new Date().toISOString();
  if (!intent) {
    await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
    return { status: "IGNORED", ignored: "PAYMENT_INTENT_NOT_FOUND" };
  }
  if (payload.providerReference && intent.provider_reference && payload.providerReference !== intent.provider_reference) {
    throw new SecurityError("PAYMENT_PROVIDER_REFERENCE_MISMATCH", 409);
  }
  if (payload.amountMinor !== undefined && payload.amountMinor !== intent.amount_minor) {
    throw new SecurityError("PAYMENT_AMOUNT_MISMATCH", 409);
  }
  if (payload.currency && payload.currency.toUpperCase() !== intent.currency.toUpperCase()) {
    throw new SecurityError("PAYMENT_CURRENCY_MISMATCH", 409);
  }
  const isSuccessfulEvent = successfulEvents.has(payload.eventType) || payload.status === "SUCCEEDED";
  if (isSuccessfulEvent && (!payload.providerReference || payload.amountMinor === undefined || !payload.currency)) {
    throw new SecurityError("PAYMENT_SETTLEMENT_FIELDS_REQUIRED", 409);
  }
  if (isSuccessfulEvent) {
    if (intent.status === "REFUNDED" || intent.status === "DISPUTED") {
      await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
      return { status: "IGNORED", paymentIntentId: intent.id, ignored: "PAYMENT_INTENT_TERMINAL" };
    }
    const accountId = await ensureCreditAccount(d1, { facilityId: intent.facility_id, userId: intent.user_id });
    const purchaseKey = `payment:${intent.id}:purchase`;
    const existingPurchase = await d1.prepare(`SELECT id FROM credit_ledger_entries
      WHERE credit_account_id = ? AND entry_type = 'PURCHASE' AND idempotency_key = ? LIMIT 1`)
      .bind(accountId, purchaseKey).first<{ id: string }>();
    // A provider can retry the same settlement with a new event ID. The
    // purchase ledger key is authoritative, so acknowledge the new event
    // without attempting a second balance mutation or version bump.
    const alreadySettled = intent.status === "SUCCEEDED" && Boolean(existingPurchase);
    const evidenceGuard = paymentEventEvidenceGuard({ intentId: intent.id, correlationId, facilityId: intent.facility_id, userId: intent.user_id, ledgerKey: `payment:${intent.id}:purchase`, accountId });
    const settlementStatements = alreadySettled ? [] : settlePaymentPurchaseStatements(d1, { paymentIntentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, accountId, amount: intent.credit_quantity, reason: `Payment ${eventKey} settled.`, now, requireSucceeded: true });
    const results = await d1.batch([
      ...(alreadySettled ? [] : [d1.prepare("UPDATE payment_intents SET provider = ?, status = 'SUCCEEDED', provider_reference = COALESCE(?, provider_reference), version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND user_id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED', 'FAILED', 'EXPIRED', 'SUCCEEDED')").bind(provider, payload.providerReference || null, now, intent.id, intent.facility_id, intent.user_id)]),
      ...paymentEventTrail(d1, { intentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, eventKey, status: "SUCCEEDED", eventType: payload.eventType, correlationId }),
      ...settlementStatements,
      d1.prepare(`UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ? AND ${evidenceGuard.sql}`).bind(now, provider, eventKey, ...evidenceGuard.values),
    ]);
    const statusWriteIndex = alreadySettled ? null : 0;
    const trailIndex = alreadySettled ? 0 : 1;
    const settlementStartIndex = trailIndex + 1;
    const processedIndex = results.length - 1;
    if (statusWriteIndex !== null && !results[statusWriteIndex]?.meta.changes) throw new SecurityError("PAYMENT_INTENT_STATE_CHANGED", 409);
    if (!results[trailIndex]?.meta.changes || !settlementStatements.every((_, index) => Boolean(results[settlementStartIndex + index]?.meta.changes)) || !results[processedIndex]?.meta.changes) {
      throw new SecurityError("PAYMENT_SETTLEMENT_INCOMPLETE", 503);
    }
    return { status: "SUCCEEDED", paymentIntentId: intent.id };
  }
  if (failedEvents.has(payload.eventType) || ["FAILED", "EXPIRED", "REFUNDED", "DISPUTED"].includes(payload.status || "")) {
    const nextStatus = payload.eventType.includes("REFUND") || payload.status === "REFUNDED" ? "REFUNDED" : payload.eventType.includes("DISPUT") || payload.status === "DISPUTED" ? "DISPUTED" : payload.eventType.includes("EXPIRED") || payload.status === "EXPIRED" ? "EXPIRED" : "FAILED";
    if (nextStatus === "REFUNDED" || nextStatus === "DISPUTED") {
      const allowedPriorStatuses = nextStatus === "REFUNDED" ? "('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED')" : "('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'DISPUTED')";
      const current = await d1.prepare("SELECT status FROM payment_intents WHERE id = ?").bind(intent.id).first<{ status: string }>();
      if (!current) throw new SecurityError("PAYMENT_INTENT_STATE_UNAVAILABLE", 503);
      let refundStatements: D1PreparedStatement[] = [];
      let refundAccountId: string | null = null;
      if (nextStatus === "REFUNDED") {
        const purchase = await d1.prepare(`SELECT cle.credit_account_id, cle.amount
          FROM credit_ledger_entries cle
          INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id
            AND ca.facility_id = ? AND ca.user_id = ?
          WHERE cle.idempotency_key = ? AND cle.entry_type = 'PURCHASE' LIMIT 1`)
          .bind(intent.facility_id, intent.user_id, `payment:${intent.id}:purchase`)
          .first<{ credit_account_id: string; amount: number }>();
        if (!purchase) throw new SecurityError("PAYMENT_REFUND_PENDING", 503);
        refundAccountId = purchase.credit_account_id;
        refundStatements = refundPurchasedCreditsStatements(d1, { paymentIntentId: intent.id, accountId: purchase.credit_account_id, amount: purchase.amount, actorUserId: "system:payment-webhook", reason: `Provider refund event ${eventKey}.`, now });
      }
      const evidenceGuard = paymentEventEvidenceGuard({ intentId: intent.id, correlationId, facilityId: intent.facility_id, userId: intent.user_id, ledgerKey: nextStatus === "REFUNDED" ? `payment:${intent.id}:refund` : undefined, accountId: refundAccountId || undefined });
      const results = await d1.batch([
        d1.prepare(`UPDATE payment_intents SET provider = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND user_id = ? AND status IN ${allowedPriorStatuses}`).bind(provider, nextStatus, now, intent.id, intent.facility_id, intent.user_id),
        ...paymentEventTrail(d1, { intentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, eventKey, status: nextStatus, eventType: payload.eventType, correlationId }),
        ...refundStatements,
        d1.prepare("UPDATE payment_refund_requests SET status = 'COMPLETED', provider_reference = COALESCE(?, provider_reference), updated_at = ? WHERE payment_intent_id = ? AND status = 'REQUESTED'").bind(payload.providerReference || null, now, intent.id),
        d1.prepare(`UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ? AND ${evidenceGuard.sql}`).bind(now, provider, eventKey, ...evidenceGuard.values),
      ]);
      if (!results[0]?.meta.changes) {
        await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
        return { status: current.status, paymentIntentId: intent.id, ignored: "PAYMENT_INTENT_STATE_CHANGED" };
      }
      const refundWritesStart = 3;
      const refundWritesEnd = refundWritesStart + refundStatements.length;
      const refundWritesCommitted = results.slice(refundWritesStart, refundWritesEnd).every((result) => Boolean(result?.meta.changes));
      // A provider may refund a payment without a pre-existing SecureVisit
      // refund request, so the local request-status update is optional. The
      // payment transition, audit/outbox trail, every credit ledger/balance
      // write, and provider-event acknowledgement are not optional.
      if (!results[1]?.meta.changes || !results[2]?.meta.changes || !refundWritesCommitted || !results[results.length - 1]?.meta.changes) {
        throw new SecurityError("PAYMENT_SETTLEMENT_INCOMPLETE", 503);
      }
      return { status: nextStatus, paymentIntentId: intent.id };
    }
    const evidenceGuard = paymentEventEvidenceGuard({ intentId: intent.id, correlationId });
    const results = await d1.batch([
      d1.prepare(`UPDATE payment_intents SET provider = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED', 'FAILED', 'EXPIRED')`).bind(provider, nextStatus, now, intent.id),
      ...paymentEventTrail(d1, { intentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, eventKey, status: nextStatus, eventType: payload.eventType, correlationId }),
      d1.prepare(`UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ? AND ${evidenceGuard.sql}`).bind(now, provider, eventKey, ...evidenceGuard.values),
    ]);
    if (!results[0]?.meta.changes) {
      if (results[1]?.meta.changes || results[2]?.meta.changes) throw new SecurityError("PAYMENT_SETTLEMENT_INCOMPLETE", 503);
      await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
      return { status: intent.status, paymentIntentId: intent.id, ignored: "PAYMENT_INTENT_STATE_CHANGED" };
    }
    if (!results[1]?.meta.changes || !results[2]?.meta.changes || !results[3]?.meta.changes) throw new SecurityError("PAYMENT_SETTLEMENT_INCOMPLETE", 503);
    return { status: nextStatus, paymentIntentId: intent.id };
  }
  await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
  return { status: "IGNORED", paymentIntentId: intent.id, ignored: "UNSUPPORTED_PAYMENT_EVENT" };
}
