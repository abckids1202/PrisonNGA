import { getD1 } from "../../../../db/runtime";
import { getRuntimeValue, getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { serializePaymentWebhookSnapshot, verifyPaymentWebhookSignature, type PaymentWebhook } from "../../../../lib/server/payments/provider";
import { processPaymentProviderEvent } from "../../../../lib/server/payments/process-event";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";

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
    const inserted = await d1.prepare(`INSERT OR IGNORE INTO payment_provider_events (id, provider, event_key, event_type, payload, status, attempt_count, available_at, created_at) VALUES (?, ?, ?, ?, ?, 'RECEIVED', 0, CURRENT_TIMESTAMP, ?)`).bind(crypto.randomUUID(), provider, eventKey, eventType, eventSnapshot, new Date().toISOString()).run();
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
      if (prior.status !== "RECEIVED" && prior.status !== "FAILED") return securityResponse({ accepted: false, retryable: true, eventKey }, 503, context.requestId);
    }
    const result = await processPaymentProviderEvent(d1, { provider, eventKey, payload: payload as PaymentWebhook });
    return securityResponse({ accepted: true, paymentIntentId: result.paymentIntentId, status: result.status, ignored: result.ignored, eventKey }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
