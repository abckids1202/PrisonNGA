import { getRuntimeValue } from "../security";
import { isSecureHttpsEndpoint } from "../endpoint";
import { sendEmailWithResend, sendSmsWithTwilio } from "../messaging/providers";
import { readBoundedResponseText } from "../bounded-response";
import type { DeliveryReceipt } from "../messaging/providers";

export type VisitorAuthDelivery = "console" | "webhook" | "resend" | "twilio" | "";

export async function getVisitorAuthDelivery(channel: "EMAIL" | "SMS"): Promise<VisitorAuthDelivery> {
  const channelValue = await getRuntimeValue(channel === "EMAIL" ? "VISITOR_EMAIL_DELIVERY" : "VISITOR_SMS_DELIVERY");
  const legacyValue = await getRuntimeValue("VISITOR_AUTH_DELIVERY");
  const value = (channelValue || legacyValue || "").toLowerCase();
  return value === "console" || value === "webhook" || value === "resend" || value === "twilio" ? value : "";
}

/** Return only whether the selected adapter has usable runtime configuration. */
export async function isVisitorAuthDeliveryConfigured(channel: "EMAIL" | "SMS"): Promise<boolean> {
  const delivery = await getVisitorAuthDelivery(channel);
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT");
  if (delivery === "console") return environment === "development";
  if (delivery === "webhook") {
    const url = await getRuntimeValue("VISITOR_AUTH_WEBHOOK_URL");
    return Boolean(url && isSecureHttpsEndpoint(url) && await getRuntimeValue("VISITOR_AUTH_WEBHOOK_SECRET"));
  }
  if (delivery === "resend" && channel === "EMAIL") {
    return Boolean(await getRuntimeValue("VISITOR_EMAIL_RESEND_API_KEY") && await getRuntimeValue("VISITOR_EMAIL_RESEND_FROM"));
  }
  if (delivery === "twilio" && channel === "SMS") {
    const accountSid = await getRuntimeValue("VISITOR_SMS_TWILIO_ACCOUNT_SID");
    const authToken = await getRuntimeValue("VISITOR_SMS_TWILIO_AUTH_TOKEN");
    const sender = await getRuntimeValue("VISITOR_SMS_TWILIO_FROM") || await getRuntimeValue("VISITOR_SMS_TWILIO_MESSAGING_SERVICE_SID");
    return Boolean(accountSid && authToken && sender);
  }
  return false;
}

export async function deliverVisitorChallenge(input: { channel: "EMAIL" | "SMS"; challengeId: string; destination: string; code: string; expiresAt: string }): Promise<DeliveryReceipt> {
  const delivery = await getVisitorAuthDelivery(input.channel);
  if (delivery === "resend" && input.channel === "EMAIL") return sendEmailWithResend({ destination: input.destination, subject: "Your SecureVisit sign-in code", text: `Your SecureVisit code is ${input.code}. It expires in 10 minutes. If you did not request this code, you can ignore this message.`, idempotencyKey: `securevisit-auth:${input.challengeId}` });
  if (delivery === "twilio" && input.channel === "SMS") return sendSmsWithTwilio({ destination: input.destination, body: `Your SecureVisit code is ${input.code}. It expires in 10 minutes.`, idempotencyKey: `securevisit-auth:${input.challengeId}` });
  if (delivery !== "webhook") throw new Error("VISITOR_AUTH_DELIVERY_NOT_CONFIGURED");
  const url = await getRuntimeValue("VISITOR_AUTH_WEBHOOK_URL");
  const secret = await getRuntimeValue("VISITOR_AUTH_WEBHOOK_SECRET");
  if (!url || !isSecureHttpsEndpoint(url) || !secret) throw new Error("VISITOR_AUTH_DELIVERY_NOT_CONFIGURED");
  const payload = JSON.stringify({ type: "VISITOR_AUTH_CODE", channel: input.channel, challengeId: input.challengeId, destination: input.destination, code: input.code, expiresAt: input.expiresAt });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  const signature = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `visitor-auth:${input.challengeId}`, "x-securevisit-timestamp": timestamp, "x-securevisit-signature": `sha256=${signature}` }, body: payload, signal: controller.signal });
    if (!response.ok) throw new Error(`VISITOR_AUTH_DELIVERY_FAILED_${response.status}`);
    let responseBody: { providerReference?: unknown; id?: unknown; sid?: unknown };
    try {
      // Keep the timeout active through bounded body consumption. A delivery
      // provider that sends headers and then stalls must fail closed.
      responseBody = JSON.parse(await readBoundedResponseText(response)) as { providerReference?: unknown; id?: unknown; sid?: unknown };
    } catch {
      throw new Error("VISITOR_AUTH_DELIVERY_INVALID_RESPONSE");
    }
    const providerReference = typeof responseBody.providerReference === "string" ? responseBody.providerReference.trim() : typeof responseBody.id === "string" ? responseBody.id.trim() : typeof responseBody.sid === "string" ? responseBody.sid.trim() : "";
    if (!providerReference) throw new Error("VISITOR_AUTH_DELIVERY_INVALID_RESPONSE");
    return { providerReference };
  } finally {
    clearTimeout(timeout);
  }
}
