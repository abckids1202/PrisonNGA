import { getRuntimeValue } from "../security";

export async function deliverVisitorChallenge(input: { channel: "EMAIL" | "SMS"; challengeId: string; destination: string; code: string; expiresAt: string }): Promise<void> {
  const url = await getRuntimeValue("VISITOR_AUTH_WEBHOOK_URL");
  const secret = await getRuntimeValue("VISITOR_AUTH_WEBHOOK_SECRET");
  if (!url || !/^https:\/\//i.test(url) || !secret) throw new Error("VISITOR_AUTH_DELIVERY_NOT_CONFIGURED");
  const payload = JSON.stringify({ type: "VISITOR_AUTH_CODE", channel: input.channel, challengeId: input.challengeId, destination: input.destination, code: input.code, expiresAt: input.expiresAt });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const signature = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-securevisit-signature": `sha256=${signature}` }, body: payload, signal: controller.signal });
    if (!response.ok) throw new Error(`VISITOR_AUTH_DELIVERY_FAILED_${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}
