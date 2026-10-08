import { getRuntimeValue } from "../security";

async function requestWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendEmailWithResend(input: { destination: string; subject: string; text: string; idempotencyKey: string }): Promise<void> {
  const apiKey = await getRuntimeValue("RESEND_API_KEY");
  const from = await getRuntimeValue("VISITOR_EMAIL_FROM");
  if (!apiKey || !from) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const response = await requestWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify({ from, to: [input.destination], subject: input.subject, text: input.text }),
  });
  if (!response.ok) throw new Error(`EMAIL_PROVIDER_FAILED_${response.status}`);
}

export async function sendSmsWithTwilio(input: { destination: string; body: string; idempotencyKey: string }): Promise<void> {
  const accountSid = await getRuntimeValue("VISITOR_SMS_TWILIO_ACCOUNT_SID");
  const authToken = await getRuntimeValue("VISITOR_SMS_TWILIO_AUTH_TOKEN");
  const from = await getRuntimeValue("VISITOR_SMS_TWILIO_FROM");
  const messagingServiceSid = await getRuntimeValue("VISITOR_SMS_TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || (!from && !messagingServiceSid)) throw new Error("SMS_PROVIDER_NOT_CONFIGURED");
  const params = new URLSearchParams({ To: input.destination, Body: input.body });
  if (messagingServiceSid) params.set("MessagingServiceSid", messagingServiceSid);
  else params.set("From", from || "");
  const basic = btoa(`${accountSid}:${authToken}`);
  const response = await requestWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": input.idempotencyKey },
    body: params.toString(),
  });
  if (!response.ok) throw new Error(`SMS_PROVIDER_FAILED_${response.status}`);
}
