import { refundPurchasedCredits, settlePaymentPurchase } from "../credits";
import { SecurityError } from "../security";
import type { PaymentWebhook } from "./provider";

const successfulEvents = new Set(["PAYMENT_SUCCEEDED", "PAYMENT_PAID", "PAYMENT_SUCCESS", "SUCCEEDED", "PAID"]);
const failedEvents = new Set(["PAYMENT_FAILED", "PAYMENT_EXPIRED", "PAYMENT_REFUNDED", "PAYMENT_DISPUTED", "FAILED", "EXPIRED", "REFUNDED", "DISPUTED"]);

export async function processPaymentProviderEvent(d1: D1Database, input: { provider: string; eventKey: string; payload: PaymentWebhook }): Promise<{ status: string; paymentIntentId?: string; ignored?: string }> {
  const { provider, eventKey, payload } = input;
  const intent = await d1.prepare(`SELECT id, facility_id, user_id, provider, credit_quantity, status, version FROM payment_intents WHERE id = ? OR provider_reference = ? LIMIT 1`).bind(payload.paymentIntentId || "", payload.providerReference || "").first<{ id: string; facility_id: string; user_id: string; provider: string; credit_quantity: number; status: string; version: number }>();
  const now = new Date().toISOString();
  if (!intent) {
    await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
    return { status: "IGNORED", ignored: "PAYMENT_INTENT_NOT_FOUND" };
  }
  if (successfulEvents.has(payload.eventType) || payload.status === "SUCCEEDED") {
    if (intent.status === "REFUNDED" || intent.status === "DISPUTED") {
      await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
      return { status: "IGNORED", paymentIntentId: intent.id, ignored: "PAYMENT_INTENT_TERMINAL" };
    }
    const settlement = await settlePaymentPurchase(d1, { paymentIntentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, amount: intent.credit_quantity, reason: `Payment ${eventKey} settled.`, requirePayableIntent: true });
    if ("terminal" in settlement && settlement.terminal) {
      await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
      return { status: "IGNORED", paymentIntentId: intent.id, ignored: "PAYMENT_INTENT_TERMINAL" };
    }
    await d1.batch([
      d1.prepare("UPDATE payment_intents SET provider = ?, status = 'SUCCEEDED', provider_reference = COALESCE(?, provider_reference), version = version + 1, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED', 'FAILED', 'EXPIRED', 'SUCCEEDED')").bind(provider, payload.providerReference || null, now, intent.id),
      d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey),
    ]);
    return { status: "SUCCEEDED", paymentIntentId: intent.id };
  }
  if (failedEvents.has(payload.eventType) || ["FAILED", "EXPIRED", "REFUNDED", "DISPUTED"].includes(payload.status || "")) {
    const nextStatus = payload.eventType.includes("REFUND") || payload.status === "REFUNDED" ? "REFUNDED" : payload.eventType.includes("DISPUT") || payload.status === "DISPUTED" ? "DISPUTED" : payload.eventType.includes("EXPIRED") || payload.status === "EXPIRED" ? "EXPIRED" : "FAILED";
    if (nextStatus === "REFUNDED" || nextStatus === "DISPUTED") {
      const allowedPriorStatuses = nextStatus === "REFUNDED" ? "('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED')" : "('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'DISPUTED')";
      await d1.prepare(`UPDATE payment_intents SET provider = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status IN ${allowedPriorStatuses}`).bind(provider, nextStatus, now, intent.id).run();
      const current = await d1.prepare("SELECT status FROM payment_intents WHERE id = ?").bind(intent.id).first<{ status: string }>();
      if (!current) throw new SecurityError("PAYMENT_INTENT_STATE_UNAVAILABLE", 503);
      if (current.status === "REFUNDED") {
        const refund = await refundPurchasedCredits(d1, { paymentIntentId: intent.id, actorUserId: "system:payment-webhook", reason: `Provider refund event ${eventKey}.` });
        if ("pending" in refund && refund.pending) throw new SecurityError("PAYMENT_REFUND_PENDING", 503);
      }
      await d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
      return { status: current.status, paymentIntentId: intent.id };
    }
    await d1.batch([
      d1.prepare(`UPDATE payment_intents SET provider = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED', 'FAILED', 'EXPIRED')`).bind(provider, nextStatus, now, intent.id),
      d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey),
    ]);
    return { status: nextStatus, paymentIntentId: intent.id };
  }
  await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ?, last_error = NULL WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
  return { status: "IGNORED", paymentIntentId: intent.id, ignored: "UNSUPPORTED_PAYMENT_EVENT" };
}

