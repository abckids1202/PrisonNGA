import { POST as canonicalPaymentWebhook } from "../payments/route";
import { getRequestContext, getRuntimeValue, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";
import { readTextBodyWithinLimit } from "../../../../lib/server/request-body";
import { getD1 } from "../../../../db/runtime";

type XenditData = Record<string, unknown>;
type XenditWebhook = { event?: unknown; created?: unknown; data?: unknown };

async function matchesCallbackToken(supplied: string | null, expected: string): Promise<boolean> {
  if (!supplied || !expected || supplied.length > 512) return false;
  // Compare HMACs through Web Crypto rather than using a direct string
  // comparison. The fixed comparison key is not a credential.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("securevisit-xendit-callback-token"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const expectedDigest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expected));
  return crypto.subtle.verify("HMAC", key, expectedDigest, new TextEncoder().encode(supplied));
}

function stringField(data: XenditData, key: string): string {
  return typeof data[key] === "string" ? data[key].trim() : "";
}

function amountField(data: XenditData): number | undefined {
  const amount = data.amount ?? data.request_amount;
  return typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

export function canonicalizeXenditWebhook(body: XenditWebhook): { eventId: string; eventType: string; paymentIntentId: string; providerReference?: string; status?: string; amountMinor?: number; currency?: string } {
  const event = typeof body.event === "string" ? body.event.trim().toLowerCase() : "";
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data as XenditData : null;
  if (!event || !data) throw new SecurityError("XENDIT_WEBHOOK_INVALID", 400);
  const paymentIntentId = stringField(data, "reference_id");
  const sessionId = stringField(data, "payment_session_id");
  const paymentRequestId = stringField(data, "payment_request_id");
  const refundId = stringField(data, "refund_id") || stringField(data, "id");
  if (!paymentIntentId || paymentIntentId.length > 128) throw new SecurityError("XENDIT_WEBHOOK_INVALID", 400);
  const currency = stringField(data, "currency").toUpperCase() || undefined;
  const amountMinor = amountField(data);
  if (event === "payment_session.completed") {
    if (!sessionId || !currency || amountMinor === undefined) throw new SecurityError("XENDIT_WEBHOOK_INVALID", 400);
    return { eventId: `xendit:${event}:${sessionId}`, eventType: "PAYMENT_SUCCEEDED", paymentIntentId, providerReference: sessionId, status: "SUCCEEDED", amountMinor, currency };
  }
  if (event === "payment_session.expired") {
    if (!sessionId) throw new SecurityError("XENDIT_WEBHOOK_INVALID", 400);
    return { eventId: `xendit:${event}:${sessionId}`, eventType: "PAYMENT_EXPIRED", paymentIntentId, providerReference: sessionId, status: "EXPIRED", currency };
  }
  if (event === "refund.succeeded" || event === "refund.failed") {
    const reference = refundId || paymentRequestId || paymentIntentId;
    return { eventId: `xendit:${event}:${reference}`, eventType: event === "refund.succeeded" ? "PAYMENT_REFUNDED" : "PAYMENT_REFUND_FAILED", paymentIntentId, status: event === "refund.succeeded" ? "REFUNDED" : "FAILED", amountMinor, currency };
  }
  throw new SecurityError("XENDIT_WEBHOOK_UNSUPPORTED", 400);
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    if ((await getRuntimeValue("PAYMENT_PROVIDER") || "").toLowerCase() !== "xendit") throw new SecurityError("XENDIT_WEBHOOK_NOT_CONFIGURED", 503);
    const callbackToken = await getRuntimeValue("XENDIT_WEBHOOK_TOKEN");
    if (!callbackToken || !await matchesCallbackToken(request.headers.get("x-callback-token"), callbackToken)) throw new SecurityError("XENDIT_WEBHOOK_SIGNATURE_INVALID", 401);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `xendit-webhook:${context.ipAddress || "unknown"}`, limit: 300, windowSeconds: 60 });
    const rawBody = await readTextBodyWithinLimit(request, 256 * 1024);
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody); } catch { throw new SecurityError("XENDIT_WEBHOOK_INVALID", 400); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SecurityError("XENDIT_WEBHOOK_INVALID", 400);
    const canonical = canonicalizeXenditWebhook(parsed as XenditWebhook);
    if (canonical.eventId.length > 256 || /[\u0000-\u001f\u007f]/.test(canonical.eventId)) throw new SecurityError("XENDIT_WEBHOOK_INVALID", 400);

    // Reuse the canonical signed handler so Xendit events receive the same
    // durable event record, claim/retry behavior, settlement invariants, and
    // audit/outbox evidence as the existing provider gateway.
    const paymentWebhookSecret = await getRuntimeValue("PAYMENT_WEBHOOK_SECRET");
    if (!paymentWebhookSecret) throw new SecurityError("PAYMENT_WEBHOOK_NOT_CONFIGURED", 503);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const canonicalBody = JSON.stringify(canonical);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(paymentWebhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${canonicalBody}`)));
    const signature = Array.from(signatureBytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const headers = new Headers({ "content-type": "application/json", "x-securevisit-timestamp": timestamp, "x-securevisit-signature": `sha256=${signature}`, "x-payment-provider": "xendit", "x-payment-event-id": canonical.eventId });
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
    const result = await canonicalPaymentWebhook(new Request(new URL("/api/webhooks/payments", request.url), { method: "POST", headers, body: canonicalBody }));
    return securityResponse(await result.json(), result.status, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
