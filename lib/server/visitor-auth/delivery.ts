import { getRuntimeValue } from "../security";
import { isSecureHttpsEndpoint } from "../endpoint";

export type VisitorAuthDelivery = "console" | "webhook" | "resend" | "twilio" | "";

export async function getVisitorAuthDelivery(channel: "EMAIL" | "SMS"): Promise<VisitorAuthDelivery> {
  const channelValue = await getRuntimeValue(channel === "EMAIL" ? "VISITOR_EMAIL_DELIVERY" : "VISITOR_SMS_DELIVERY");
  const legacyValue = await getRuntimeValue("VISITOR_AUTH_DELIVERY");
  const value = (channelValue || legacyValue || "").toLowerCase();
  return value === "console" || value === "webhook" || value === "resend" || value === "twilio" ? value : "";
}

async function requestWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverWithResend(input: { challengeId: string; destination: string; code: string }): Promise<void> {
  const apiKey = await getRuntimeValue("RESEND_API_KEY");
  const from = await getRuntimeValue("VISITOR_EMAIL_FROM");
  if (!apiKey || !from) throw new Error("VISITOR_AUTH_RESEND_NOT_CONFIGURED");
  const response = await requestWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `securevisit-auth:${input.challengeId}` },
    body: JSON.stringify({
      from,
      to: [input.destination],
      subject: "Your SecureVisit sign-in code",
      text: `Your SecureVisit code is ${input.code}. It expires in 10 minutes. If you did not request this code, you can ignore this message.`,
    }),
  });
  if (!response.ok) throw new Error(`VISITOR_AUTH_RESEND_FAILED_${response.status}`);
}

async function deliverWithTwilio(input: { challengeId: string; destination: string; code: string }): Promise<void> {
  const accountSid = await getRuntimeValue("VISITOR_SMS_TWILIO_ACCOUNT_SID");
  const authToken = await getRuntimeValue("VISITOR_SMS_TWILIO_AUTH_TOKEN");
  const from = await getRuntimeValue("VISITOR_SMS_TWILIO_FROM");
  const messagingServiceSid = await getRuntimeValue("VISITOR_SMS_TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || (!from && !messagingServiceSid)) throw new Error("VISITOR_AUTH_TWILIO_NOT_CONFIGURED");
  const params = new URLSearchParams({ To: input.destination, Body: `Your SecureVisit code is ${input.code}. It expires in 10 minutes.` });
  if (messagingServiceSid) params.set("MessagingServiceSid", messagingServiceSid);
  else params.set("From", from || "");
  const basic = btoa(`${accountSid}:${authToken}`);
  const response = await requestWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": `securevisit-auth:${input.challengeId}` },
    body: params.toString(),
  });
  if (!response.ok) throw new Error(`VISITOR_AUTH_TWILIO_FAILED_${response.status}`);
}

export async function deliverVisitorChallenge(input: { channel: "EMAIL" | "SMS"; challengeId: string; destination: string; code: string; expiresAt: string }): Promise<void> {
  const delivery = await getVisitorAuthDelivery(input.channel);
  if (delivery === "resend" && input.channel === "EMAIL") return deliverWithResend(input);
  if (delivery === "twilio" && input.channel === "SMS") return deliverWithTwilio(input);
  if (delivery !== "webhook") throw new Error("VISITOR_AUTH_DELIVERY_NOT_CONFIGURED");
  const url = await getRuntimeValue("VISITOR_AUTH_WEBHOOK_URL");
  const secret = await getRuntimeValue("VISITOR_AUTH_WEBHOOK_SECRET");
  if (!url || !isSecureHttpsEndpoint(url) || !secret) throw new Error("VISITOR_AUTH_DELIVERY_NOT_CONFIGURED");
  const payload = JSON.stringify({ type: "VISITOR_AUTH_CODE", channel: input.channel, challengeId: input.challengeId, destination: input.destination, code: input.code, expiresAt: input.expiresAt });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  const signature = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const response = await requestWithTimeout(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `visitor-auth:${input.challengeId}`, "x-securevisit-timestamp": timestamp, "x-securevisit-signature": `sha256=${signature}` }, body: payload });
  if (!response.ok) throw new Error(`VISITOR_AUTH_DELIVERY_FAILED_${response.status}`);
}
