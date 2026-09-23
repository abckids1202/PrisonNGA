import { getRuntimeValue } from "../security";

export async function getNotificationDelivery(): Promise<"in_app" | "webhook"> {
  return (await getRuntimeValue("NOTIFICATION_DELIVERY") || "in_app").toLowerCase() === "webhook" ? "webhook" : "in_app";
}

export async function deliverNotification(input: { notificationId: string; email: string | null; phone: string | null; template: string; title: string; body: string; payload: Record<string, unknown> }): Promise<void> {
  const url = await getRuntimeValue("NOTIFICATION_WEBHOOK_URL");
  const secret = await getRuntimeValue("NOTIFICATION_WEBHOOK_SECRET");
  if (!url || !/^https:\/\//i.test(url) || !secret) throw new Error("NOTIFICATION_DELIVERY_NOT_CONFIGURED");
  const channel = input.email ? "EMAIL" : input.phone ? "SMS" : null;
  const destination = input.email || input.phone;
  if (!channel || !destination) throw new Error("NOTIFICATION_RECIPIENT_NOT_FOUND");
  const payload = JSON.stringify({ type: "SECUREVISIT_NOTIFICATION", notificationId: input.notificationId, channel, destination, template: input.template, title: input.title, body: input.body, payload: input.payload });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const signature = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-securevisit-signature": `sha256=${signature}`, "idempotency-key": `${input.notificationId}:${channel.toLowerCase()}` }, body: payload, signal: controller.signal });
    if (!response.ok) throw new Error(`NOTIFICATION_DELIVERY_FAILED_${response.status}`);
  } finally { clearTimeout(timeout); }
}
