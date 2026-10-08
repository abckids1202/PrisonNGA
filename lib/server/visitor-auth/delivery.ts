import { getRuntimeValue } from "../security";
import { isSecureHttpsEndpoint } from "../endpoint";
import { sendEmailWithResend, sendSmsWithTwilio } from "../messaging/providers";

export type VisitorAuthDelivery = "console" | "webhook" | "resend" | "twilio" | "";

export async function getVisitorAuthDelivery(channel: "EMAIL" | "SMS"): Promise<VisitorAuthDelivery> {
  const channelValue = await getRuntimeValue(channel === "EMAIL" ? "VISITOR_EMAIL_DELIVERY" : "VISITOR_SMS_DELIVERY");
  const legacyValue = await getRuntimeValue("VISITOR_AUTH_DELIVERY");
  const value = (channelValue || legacyValue || "").toLowerCase();
  return value === "console" || value === "webhook" || value === "resend" || value === "twilio" ? value : "";
}

export async function deliverVisitorChallenge(input: { channel: "EMAIL" | "SMS"; challengeId: string; destination: string; code: string; expiresAt: string }): Promise<void> {
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
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `visitor-auth:${input.challengeId}`, "x-securevisit-timestamp": timestamp, "x-securevisit-signature": `sha256=${signature}` }, body: payload, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`VISITOR_AUTH_DELIVERY_FAILED_${response.status}`);
}
