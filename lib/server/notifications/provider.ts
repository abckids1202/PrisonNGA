import { getRuntimeValue } from "../security";
import { isSecureHttpsEndpoint } from "../endpoint";
import { sendEmailWithResend, sendSmsWithTwilio } from "../messaging/providers";
import { readBoundedResponseText } from "../bounded-response";
import type { DeliveryReceipt } from "../messaging/providers";

export type NotificationDelivery = "in_app" | "webhook" | "resend" | "twilio";

export async function getNotificationDelivery(channel?: "EMAIL" | "SMS"): Promise<NotificationDelivery> {
  const channelValue = channel === "EMAIL"
    ? await getRuntimeValue("NOTIFICATION_EMAIL_DELIVERY")
    : channel === "SMS" ? await getRuntimeValue("NOTIFICATION_SMS_DELIVERY") : null;
  const configured = channelValue || await getRuntimeValue("NOTIFICATION_DELIVERY");
  // No configured adapter is an intentional development default. An
  // explicitly supplied but unsupported value must fail closed instead of
  // silently dropping an institutional notification into in-app delivery.
  if (!configured) return "in_app";
  const value = configured.toLowerCase();
  if (value === "in_app" || value === "webhook" || value === "resend" || value === "twilio") return value;
  throw new Error("NOTIFICATION_DELIVERY_INVALID");
}

export async function deliverNotification(input: { notificationId: string; email: string | null; phone: string | null; template: string; title: string; body: string; payload: Record<string, unknown> }): Promise<DeliveryReceipt> {
  const channel = input.email ? "EMAIL" : input.phone ? "SMS" : null;
  const delivery = channel ? await getNotificationDelivery(channel) : "in_app";
  if (delivery === "resend" && channel === "EMAIL" && input.email) return sendEmailWithResend({ destination: input.email, subject: input.title, text: input.body, idempotencyKey: `${input.notificationId}:email` });
  if (delivery === "twilio" && channel === "SMS" && input.phone) return sendSmsWithTwilio({ destination: input.phone, body: input.body, idempotencyKey: `${input.notificationId}:sms` });
  if (delivery !== "webhook") throw new Error("NOTIFICATION_DELIVERY_NOT_CONFIGURED");
  const url = await getRuntimeValue("NOTIFICATION_WEBHOOK_URL");
  const secret = await getRuntimeValue("NOTIFICATION_WEBHOOK_SECRET");
  if (!url || !isSecureHttpsEndpoint(url) || !secret) throw new Error("NOTIFICATION_DELIVERY_NOT_CONFIGURED");
  const destination = input.email || input.phone;
  if (!channel || !destination) throw new Error("NOTIFICATION_RECIPIENT_NOT_FOUND");
  const payload = JSON.stringify({ type: "SECUREVISIT_NOTIFICATION", notificationId: input.notificationId, channel, destination, template: input.template, title: input.title, body: input.body, payload: input.payload });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  const signature = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-securevisit-timestamp": timestamp, "x-securevisit-signature": `sha256=${signature}`, "idempotency-key": `${input.notificationId}:${channel.toLowerCase()}` }, body: payload, signal: controller.signal });
    if (!response.ok) throw new Error(`NOTIFICATION_DELIVERY_FAILED_${response.status}`);
    let responseBody: { providerReference?: unknown; id?: unknown; sid?: unknown };
    try {
      responseBody = JSON.parse(await readBoundedResponseText(response)) as { providerReference?: unknown; id?: unknown; sid?: unknown };
    } catch {
      throw new Error("NOTIFICATION_DELIVERY_INVALID_RESPONSE");
    }
    const providerReference = typeof responseBody.providerReference === "string" ? responseBody.providerReference.trim() : typeof responseBody.id === "string" ? responseBody.id.trim() : typeof responseBody.sid === "string" ? responseBody.sid.trim() : "";
    if (!providerReference) throw new Error("NOTIFICATION_DELIVERY_INVALID_RESPONSE");
    return { providerReference };
  } finally { clearTimeout(timeout); }
}
