export type PaymentCheckout = { provider: string; providerReference: string; checkoutUrl: string | null };

export type PaymentWebhook = { eventId: string; eventType: string; paymentIntentId?: string; providerReference?: string; status?: string };

export interface PaymentProvider {
  createCheckout(input: { paymentIntentId: string; email: string; creditQuantity: number; amountMinor: number; currency: string }): Promise<PaymentCheckout>;
}

export async function getPaymentProvider(): Promise<PaymentProvider | null> {
  const provider = (await runtimeValue("PAYMENT_PROVIDER")).toLowerCase();
  if (!provider || provider === "none" || provider === "console") return null;
  if (provider === "webhook") {
    const url = await runtimeValue("PAYMENT_CHECKOUT_URL");
    const secret = await runtimeValue("PAYMENT_PROVIDER_SECRET");
    if (!url || !/^https:\/\//i.test(url) || !secret) return null;
    return new WebhookCheckoutProvider(url, secret);
  }
  return null;
}

class WebhookCheckoutProvider implements PaymentProvider {
  constructor(private readonly url: string, private readonly secret: string) {}

  async createCheckout(input: { paymentIntentId: string; email: string; creditQuantity: number; amountMinor: number; currency: string }): Promise<PaymentCheckout> {
    const payload = JSON.stringify(input);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(this.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
    const signature = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json", "x-securevisit-signature": `sha256=${signature}` }, body: payload, signal: controller.signal });
      if (!response.ok) throw new Error(`PAYMENT_CHECKOUT_FAILED_${response.status}`);
      const result = await response.json() as { providerReference?: unknown; checkoutUrl?: unknown };
      if (typeof result.providerReference !== "string" || !result.providerReference || (result.checkoutUrl !== null && typeof result.checkoutUrl !== "string")) throw new Error("PAYMENT_CHECKOUT_INVALID_RESPONSE");
      return { provider: "webhook", providerReference: result.providerReference, checkoutUrl: result.checkoutUrl as string | null };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function runtimeValue(key: string): Promise<string> {
  try {
    const { env } = await import("cloudflare:workers");
    const value = (env as unknown as Record<string, unknown>)[key];
    if (typeof value === "string") return value.trim();
  } catch { /* local runtime fallback below */ }
  return typeof process !== "undefined" && typeof process.env?.[key] === "string" ? process.env[key].trim() : "";
}

export async function verifyPaymentWebhookSignature(payload: string, suppliedSignature: string | null, secret: string | null): Promise<boolean> {
  if (!secret || !suppliedSignature) return false;
  const normalized = suppliedSignature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const expected = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let equal = expected.length === normalized.length;
  for (let index = 0; index < expected.length; index += 1) equal = equal && expected.charCodeAt(index) === normalized.charCodeAt(index);
  return equal;
}
