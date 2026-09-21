import { getD1 } from "../../../../db/runtime";
import { refundPurchasedCredits, settlePaymentPurchase } from "../../../../lib/server/credits";
import { getRuntimeValue, getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { verifyPaymentWebhookSignature, type PaymentWebhook } from "../../../../lib/server/payments/provider";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";

const successfulEvents = new Set(["PAYMENT_SUCCEEDED", "PAYMENT_PAID", "PAYMENT_SUCCESS", "SUCCEEDED", "PAID"]);
const failedEvents = new Set(["PAYMENT_FAILED", "PAYMENT_EXPIRED", "PAYMENT_REFUNDED", "PAYMENT_DISPUTED", "FAILED", "EXPIRED", "REFUNDED", "DISPUTED"]);

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const secret = await getRuntimeValue("PAYMENT_WEBHOOK_SECRET");
    if (!secret) throw new SecurityError("PAYMENT_WEBHOOK_NOT_CONFIGURED", 503);
    const rawBody = await request.text();
    if (!await verifyPaymentWebhookSignature(rawBody, request.headers.get("x-securevisit-signature"), secret)) throw new SecurityError("PAYMENT_WEBHOOK_SIGNATURE_INVALID", 401);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `payment-webhook:${context.ipAddress || "unknown"}`, limit: 300, windowSeconds: 60 });
    const payload = JSON.parse(rawBody) as PaymentWebhook;
    const provider = (request.headers.get("x-payment-provider") || "configured-provider").trim().slice(0, 80);
    const eventKey = payload.eventId?.trim() || request.headers.get("x-payment-event-id")?.trim();
    if (!eventKey || !payload.eventType?.trim()) throw new SecurityError("PAYMENT_WEBHOOK_INVALID", 400);
    const inserted = await d1.prepare(`INSERT OR IGNORE INTO payment_provider_events (id, provider, event_key, event_type, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'RECEIVED', ?)`).bind(crypto.randomUUID(), provider, eventKey, payload.eventType.trim().toUpperCase(), rawBody, new Date().toISOString()).run();
    if (!inserted.meta.changes) return securityResponse({ accepted: true, idempotent: true, eventKey }, 200, context.requestId);
    const intent = await d1.prepare(`SELECT id, facility_id, user_id, provider, credit_quantity, status, version FROM payment_intents WHERE id = ? OR provider_reference = ? LIMIT 1`).bind(payload.paymentIntentId || "", payload.providerReference || "").first<{ id: string; facility_id: string; user_id: string; provider: string; credit_quantity: number; status: string; version: number }>();
    if (!intent) {
      await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ? WHERE provider = ? AND event_key = ?").bind(new Date().toISOString(), provider, eventKey).run();
      return securityResponse({ accepted: true, ignored: true, reason: "PAYMENT_INTENT_NOT_FOUND", eventKey }, 200, context.requestId);
    }
    const eventType = payload.eventType.trim().toUpperCase();
    const now = new Date().toISOString();
    if (successfulEvents.has(eventType) || payload.status?.toUpperCase() === "SUCCEEDED") {
      await settlePaymentPurchase(d1, { paymentIntentId: intent.id, facilityId: intent.facility_id, userId: intent.user_id, amount: intent.credit_quantity, reason: `Payment ${eventKey} settled.` });
      await d1.batch([
        d1.prepare("UPDATE payment_intents SET provider = ?, status = 'SUCCEEDED', provider_reference = COALESCE(?, provider_reference), version = version + 1, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED')").bind(provider, payload.providerReference || null, now, intent.id),
        d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ? WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey),
      ]);
      return securityResponse({ accepted: true, paymentIntentId: intent.id, status: "SUCCEEDED", creditQuantity: intent.credit_quantity, eventKey }, 200, context.requestId);
    }
    if (failedEvents.has(eventType) || ["FAILED", "EXPIRED", "REFUNDED", "DISPUTED"].includes(payload.status?.toUpperCase() || "")) {
      const nextStatus = eventType.includes("REFUND") || payload.status?.toUpperCase() === "REFUNDED" ? "REFUNDED" : eventType.includes("DISPUT") || payload.status?.toUpperCase() === "DISPUTED" ? "DISPUTED" : eventType.includes("EXPIRED") || payload.status?.toUpperCase() === "EXPIRED" ? "EXPIRED" : "FAILED";
      if (nextStatus === "REFUNDED") await refundPurchasedCredits(d1, { paymentIntentId: intent.id, actorUserId: "system:payment-webhook", reason: `Provider refund event ${eventKey}.` });
      await d1.batch([
        d1.prepare("UPDATE payment_intents SET provider = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED')").bind(provider, nextStatus, now, intent.id),
        d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ? WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey),
      ]);
      return securityResponse({ accepted: true, paymentIntentId: intent.id, status: nextStatus, eventKey }, 200, context.requestId);
    }
    await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ? WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
    return securityResponse({ accepted: true, ignored: true, reason: "UNSUPPORTED_PAYMENT_EVENT", eventKey }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
