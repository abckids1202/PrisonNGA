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

export async function processPaymentProviderEvent(d1: D1Database, input: { provider: string; eventKey: string; payload: PaymentWebhook }): Promise<{ status: string; paymentIntentId?: string; ignored?: string }> {
  const { provider, eventKey, payload } = input;
  const correlationId = crypto.randomUUID();
  const intent = await d1.prepare(`SELECT id, facility_id, user_id, provider, provider_reference, credit_quantity, amount_minor, currency, status, version FROM payment_intents WHERE provider = ? AND (id = ? OR provider_reference = ?) LIMIT 1`).bind(provider, payload.paymentIntentId || "", payload.providerReference || "").first<{ id: string; facility_id: string; user_id: string; provider: string; provider_reference: string | null; credit_quantity: number; amount_minor: number; currency: string; status: string; version: number }>();
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
  if (successfulEvents.has(payload.eventType) || payload.status === "SUCCEEDED") {
    if (intent.status === "REFUNDED" || intent.status === "DISPUTED") {
      await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
      return { status: "IGNORED", paymentIntentId: intent.id, ignored: "PAYMENT_INTENT_TERMINAL" };
    }
    const accountId = await ensureCreditAccount(d1, { facilityId: intent.facility_id, userId: intent.user_id });
    const results = await d1.batch([
      d1.prepare("UPDATE payment_intents SET provider = ?, status = 'SUCCEEDED', provider_reference = COALESCE(?, provider_reference), version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND user_id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED', 'FAILED', 'EXPIRED', 'SUCCEEDED')").bind(provider, payload.providerReference || null, now, intent.id, intent.facility_id, intent.user_id),
      ...paymentEventTrail(d1, { intentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, eventKey, status: "SUCCEEDED", eventType: payload.eventType, correlationId }),
      ...settlePaymentPurchaseStatements(d1, { paymentIntentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, accountId, amount: intent.credit_quantity, reason: `Payment ${eventKey} settled.`, now, requireSucceeded: true }),
      d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey),
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("PAYMENT_INTENT_STATE_CHANGED", 409);
    return { status: "SUCCEEDED", paymentIntentId: intent.id };
  }
  if (failedEvents.has(payload.eventType) || ["FAILED", "EXPIRED", "REFUNDED", "DISPUTED"].includes(payload.status || "")) {
    const nextStatus = payload.eventType.includes("REFUND") || payload.status === "REFUNDED" ? "REFUNDED" : payload.eventType.includes("DISPUT") || payload.status === "DISPUTED" ? "DISPUTED" : payload.eventType.includes("EXPIRED") || payload.status === "EXPIRED" ? "EXPIRED" : "FAILED";
    if (nextStatus === "REFUNDED" || nextStatus === "DISPUTED") {
      const allowedPriorStatuses = nextStatus === "REFUNDED" ? "('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED')" : "('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'DISPUTED')";
      const current = await d1.prepare("SELECT status FROM payment_intents WHERE id = ?").bind(intent.id).first<{ status: string }>();
      if (!current) throw new SecurityError("PAYMENT_INTENT_STATE_UNAVAILABLE", 503);
      let refundStatements: D1PreparedStatement[] = [];
      if (nextStatus === "REFUNDED") {
        const accountId = await d1.prepare("SELECT cle.credit_account_id FROM credit_ledger_entries cle WHERE cle.idempotency_key = ? AND cle.entry_type = 'PURCHASE' LIMIT 1").bind(`payment:${intent.id}:purchase`).first<{ credit_account_id: string }>();
        const purchase = await d1.prepare("SELECT amount FROM credit_ledger_entries WHERE idempotency_key = ? AND entry_type = 'PURCHASE' LIMIT 1").bind(`payment:${intent.id}:purchase`).first<{ amount: number }>();
        if (!accountId || !purchase) throw new SecurityError("PAYMENT_REFUND_PENDING", 503);
        refundStatements = refundPurchasedCreditsStatements(d1, { paymentIntentId: intent.id, accountId: accountId.credit_account_id, amount: purchase.amount, actorUserId: "system:payment-webhook", reason: `Provider refund event ${eventKey}.`, now });
      }
      const results = await d1.batch([
        d1.prepare(`UPDATE payment_intents SET provider = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND user_id = ? AND status IN ${allowedPriorStatuses}`).bind(provider, nextStatus, now, intent.id, intent.facility_id, intent.user_id),
        ...paymentEventTrail(d1, { intentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, eventKey, status: nextStatus, eventType: payload.eventType, correlationId }),
        ...refundStatements,
        d1.prepare("UPDATE payment_refund_requests SET status = 'COMPLETED', provider_reference = COALESCE(?, provider_reference), updated_at = ? WHERE payment_intent_id = ? AND status = 'REQUESTED'").bind(payload.providerReference || null, now, intent.id),
        d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey),
      ]);
      if (!results[0]?.meta.changes) {
        await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
        return { status: current.status, paymentIntentId: intent.id, ignored: "PAYMENT_INTENT_STATE_CHANGED" };
      }
      return { status: nextStatus, paymentIntentId: intent.id };
    }
    const results = await d1.batch([
      d1.prepare(`UPDATE payment_intents SET provider = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED', 'FAILED', 'EXPIRED')`).bind(provider, nextStatus, now, intent.id),
      ...paymentEventTrail(d1, { intentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, eventKey, status: nextStatus, eventType: payload.eventType, correlationId }),
      d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey),
    ]);
    if (!results[0]?.meta.changes) {
      await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
      return { status: intent.status, paymentIntentId: intent.id, ignored: "PAYMENT_INTENT_STATE_CHANGED" };
    }
    return { status: nextStatus, paymentIntentId: intent.id };
  }
  await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
  return { status: "IGNORED", paymentIntentId: intent.id, ignored: "UNSUPPORTED_PAYMENT_EVENT" };
}
