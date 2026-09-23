import { getD1 } from "../../../../db/runtime";
import { refundPurchasedCredits, settlePaymentPurchase } from "../../../../lib/server/credits";
import { getRuntimeValue, getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { serializePaymentWebhookSnapshot, verifyPaymentWebhookSignature, type PaymentWebhook } from "../../../../lib/server/payments/provider";
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
    let parsedPayload: unknown;
    try { parsedPayload = JSON.parse(rawBody); } catch { throw new SecurityError("PAYMENT_WEBHOOK_INVALID", 400); }
    if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) throw new SecurityError("PAYMENT_WEBHOOK_INVALID", 400);
    const untrustedPayload = parsedPayload as Partial<PaymentWebhook>;
    if (typeof untrustedPayload.eventType !== "string" || !untrustedPayload.eventType.trim()
      || [untrustedPayload.eventId, untrustedPayload.paymentIntentId, untrustedPayload.providerReference, untrustedPayload.status].some((value) => value !== undefined && typeof value !== "string")) {
      throw new SecurityError("PAYMENT_WEBHOOK_INVALID", 400);
    }
    const eventType = untrustedPayload.eventType.trim().toUpperCase();
    const payload: Partial<PaymentWebhook> = {
      eventId: untrustedPayload.eventId?.trim(),
      eventType,
      paymentIntentId: untrustedPayload.paymentIntentId?.trim(),
      providerReference: untrustedPayload.providerReference?.trim(),
      status: untrustedPayload.status?.trim().toUpperCase(),
    };
    const provider = (request.headers.get("x-payment-provider") || "configured-provider").trim().slice(0, 80);
    const eventKey = payload.eventId || request.headers.get("x-payment-event-id")?.trim();
    if (!eventKey || eventKey.length > 256 || /[\u0000-\u001f\u007f]/.test(eventKey) || !provider) throw new SecurityError("PAYMENT_WEBHOOK_INVALID", 400);
    if (eventType.length > 80 || (payload.paymentIntentId?.length || 0) > 128 || (payload.providerReference?.length || 0) > 256 || (payload.status?.length || 0) > 80) {
      throw new SecurityError("PAYMENT_WEBHOOK_INVALID", 400);
    }
    const eventSnapshot = serializePaymentWebhookSnapshot({
      eventType,
      paymentIntentId: payload.paymentIntentId,
      providerReference: payload.providerReference,
      status: payload.status,
    });
    const inserted = await d1.prepare(`INSERT OR IGNORE INTO payment_provider_events (id, provider, event_key, event_type, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'RECEIVED', ?)`).bind(crypto.randomUUID(), provider, eventKey, eventType, eventSnapshot, new Date().toISOString()).run();
    if (!inserted.meta.changes) {
      const prior = await d1.prepare("SELECT status, payload FROM payment_provider_events WHERE provider = ? AND event_key = ?").bind(provider, eventKey).first<{ status: string; payload: string }>();
      if (!prior) throw new SecurityError("PAYMENT_EVENT_STATE_UNAVAILABLE", 503);
      if (prior.payload !== eventSnapshot) {
        let legacySnapshot: string | null = null;
        try {
          const legacyPayload = JSON.parse(prior.payload) as Partial<PaymentWebhook>;
          if (legacyPayload && typeof legacyPayload === "object" && typeof legacyPayload.eventType === "string"
            && [legacyPayload.paymentIntentId, legacyPayload.providerReference, legacyPayload.status].every((value) => value === undefined || typeof value === "string")) {
            legacySnapshot = serializePaymentWebhookSnapshot({
              eventType: legacyPayload.eventType,
              paymentIntentId: legacyPayload.paymentIntentId,
              providerReference: legacyPayload.providerReference,
              status: legacyPayload.status,
            });
          }
        } catch { /* Pre-snapshot event records are left untouched unless their settlement fields match. */ }
        if (legacySnapshot !== eventSnapshot) throw new SecurityError("PAYMENT_EVENT_KEY_REUSED", 409);
        await d1.prepare("UPDATE payment_provider_events SET payload = ? WHERE provider = ? AND event_key = ? AND payload = ?")
          .bind(eventSnapshot, provider, eventKey, prior.payload).run();
      }
      if (prior.status === "PROCESSED" || prior.status === "IGNORED") return securityResponse({ accepted: true, idempotent: true, eventKey }, 200, context.requestId);
      if (prior.status !== "RECEIVED") return securityResponse({ accepted: false, retryable: true, eventKey }, 503, context.requestId);
    }
    const intent = await d1.prepare(`SELECT id, facility_id, user_id, provider, credit_quantity, status, version FROM payment_intents WHERE id = ? OR provider_reference = ? LIMIT 1`).bind(payload.paymentIntentId || "", payload.providerReference || "").first<{ id: string; facility_id: string; user_id: string; provider: string; credit_quantity: number; status: string; version: number }>();
    if (!intent) {
      await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ? WHERE provider = ? AND event_key = ?").bind(new Date().toISOString(), provider, eventKey).run();
      return securityResponse({ accepted: true, ignored: true, reason: "PAYMENT_INTENT_NOT_FOUND", eventKey }, 200, context.requestId);
    }
    const now = new Date().toISOString();
    if (successfulEvents.has(eventType) || payload.status === "SUCCEEDED") {
      if (intent.status === "REFUNDED" || intent.status === "DISPUTED") {
        await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ? WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey).run();
        return securityResponse({ accepted: true, ignored: true, reason: "PAYMENT_INTENT_TERMINAL", eventKey }, 200, context.requestId);
      }
      const settlement = await settlePaymentPurchase(d1, {
        paymentIntentId: intent.id,
        facilityId: intent.facility_id,
        userId: intent.user_id,
        amount: intent.credit_quantity,
        reason: `Payment ${eventKey} settled.`,
        requirePayableIntent: true,
      });
      if ("terminal" in settlement && settlement.terminal) {
        await d1.prepare("UPDATE payment_provider_events SET status = 'IGNORED', processed_at = ? WHERE provider = ? AND event_key = ?")
          .bind(now, provider, eventKey).run();
        return securityResponse({ accepted: true, ignored: true, reason: "PAYMENT_INTENT_TERMINAL", eventKey }, 200, context.requestId);
      }
      await d1.batch([
        d1.prepare("UPDATE payment_intents SET provider = ?, status = 'SUCCEEDED', provider_reference = COALESCE(?, provider_reference), version = version + 1, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED', 'FAILED', 'EXPIRED', 'SUCCEEDED')").bind(provider, payload.providerReference || null, now, intent.id),
        d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ? WHERE provider = ? AND event_key = ?").bind(now, provider, eventKey),
      ]);
      return securityResponse({ accepted: true, paymentIntentId: intent.id, status: "SUCCEEDED", creditQuantity: intent.credit_quantity, eventKey }, 200, context.requestId);
    }
    if (failedEvents.has(eventType) || ["FAILED", "EXPIRED", "REFUNDED", "DISPUTED"].includes(payload.status || "")) {
      const nextStatus = eventType.includes("REFUND") || payload.status === "REFUNDED" ? "REFUNDED" : eventType.includes("DISPUT") || payload.status === "DISPUTED" ? "DISPUTED" : eventType.includes("EXPIRED") || payload.status === "EXPIRED" ? "EXPIRED" : "FAILED";
      if (nextStatus === "REFUNDED" || nextStatus === "DISPUTED") {
        const allowedPriorStatuses = nextStatus === "REFUNDED"
          ? "('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED')"
          : "('PENDING', 'CHECKOUT_CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'DISPUTED')";
        await d1.prepare(`UPDATE payment_intents SET provider = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status IN ${allowedPriorStatuses}`)
          .bind(provider, nextStatus, now, intent.id).run();
        const current = await d1.prepare("SELECT status FROM payment_intents WHERE id = ?").bind(intent.id).first<{ status: string }>();
        if (!current) throw new SecurityError("PAYMENT_INTENT_STATE_UNAVAILABLE", 503);
        if (current.status === "REFUNDED") {
          const refund = await refundPurchasedCredits(d1, { paymentIntentId: intent.id, actorUserId: "system:payment-webhook", reason: `Provider refund event ${eventKey}.` });
          if ("pending" in refund && refund.pending) throw new SecurityError("PAYMENT_REFUND_PENDING", 503);
        }
        await d1.prepare("UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ? WHERE provider = ? AND event_key = ?")
          .bind(now, provider, eventKey).run();
        return securityResponse({ accepted: true, paymentIntentId: intent.id, status: current.status, eventKey }, 200, context.requestId);
      }
      const allowedPriorStatuses = "('PENDING', 'CHECKOUT_CREATED', 'FAILED', 'EXPIRED')";
      await d1.batch([
        d1.prepare(`UPDATE payment_intents SET provider = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status IN ${allowedPriorStatuses}`).bind(provider, nextStatus, now, intent.id),
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
