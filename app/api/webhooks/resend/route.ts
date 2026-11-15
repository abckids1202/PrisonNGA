import { getRequestContext, getRuntimeValue, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";
import { readTextBodyWithinLimit } from "../../../../lib/server/request-body";
import { getD1 } from "../../../../db/runtime";
import { verifyResendWebhook, normalizeResendDeliveryEvent } from "../../../../lib/server/messaging/resend-webhook";
import { POST as canonicalStatusWebhook } from "../notifications/status/route";

async function signStatusPayload(payload: string, secret: string, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const resendSecret = await getRuntimeValue("RESEND_WEBHOOK_SECRET");
    const statusSecret = await getRuntimeValue("NOTIFICATION_STATUS_WEBHOOK_SECRET");
    if (!resendSecret || !statusSecret) throw new SecurityError("RESEND_WEBHOOK_NOT_CONFIGURED", 503);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `resend-webhook:${context.ipAddress || "unknown"}`, limit: 300, windowSeconds: 60 });
    const rawBody = await readTextBodyWithinLimit(request, 64 * 1024);
    await verifyResendWebhook(rawBody, request.headers, resendSecret);
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody); } catch { throw new SecurityError("RESEND_WEBHOOK_INVALID", 400); }
    const eventId = request.headers.get("svix-id")?.trim() || "";
    const normalized = normalizeResendDeliveryEvent(parsed, eventId);
    if (!normalized) return securityResponse({ accepted: true, ignored: true, eventId }, 200, context.requestId);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({ ...normalized, provider: "resend" });
    const signature = await signStatusPayload(payload, statusSecret, timestamp);
    const result = await canonicalStatusWebhook(new Request(new URL("/api/webhooks/notifications/status", request.url), {
      method: "POST",
      headers: { "content-type": "application/json", "x-securevisit-timestamp": timestamp, "x-securevisit-signature": `sha256=${signature}` },
      body: payload,
    }));
    return securityResponse(await result.json(), result.status, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
