export type PaymentCheckout = { provider: string; providerReference: string; checkoutUrl: string | null };
export type PaymentRefundRequest = { provider: string; providerReference: string };

export type PaymentWebhook = { eventId: string; eventType: string; paymentIntentId?: string; providerReference?: string; status?: string; amountMinor?: number; currency?: string };

export function serializePaymentWebhookSnapshot(payload: Pick<PaymentWebhook, "eventType" | "paymentIntentId" | "providerReference" | "status" | "amountMinor" | "currency">): string {
  return JSON.stringify({
    eventType: payload.eventType.trim().toUpperCase(),
    paymentIntentId: payload.paymentIntentId?.trim() || null,
    providerReference: payload.providerReference?.trim() || null,
    status: payload.status?.trim().toUpperCase() || null,
    amountMinor: payload.amountMinor ?? null,
    currency: payload.currency?.trim().toUpperCase() || null,
  });
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: { paymentIntentId: string; email: string | null; phone: string | null; creditQuantity: number; amountMinor: number; currency: string; successUrl?: string; cancelUrl?: string }): Promise<PaymentCheckout>;
  requestRefund(input: { paymentIntentId: string; providerReference: string; amountMinor: number; currency: string; reason: string }): Promise<PaymentRefundRequest>;
}

export async function getPaymentProvider(): Promise<PaymentProvider | null> {
  const provider = (await runtimeValue("PAYMENT_PROVIDER")).toLowerCase();
  if (!provider || provider === "none" || provider === "console") return null;
  // This deterministic adapter exists only for local acceptance tests; staging
  // and production environment validation require the signed webhook adapter.
  if (provider === "local_test") {
    return (await runtimeValue("SECUREVISIT_ENVIRONMENT")) === "development" ? new LocalDevelopmentPaymentProvider() : null;
  }
  if (provider === "webhook") {
    const url = await runtimeValue("PAYMENT_CHECKOUT_URL");
    const refundUrl = await runtimeValue("PAYMENT_REFUND_URL");
    const secret = await runtimeValue("PAYMENT_PROVIDER_SECRET");
    const isLocalDevelopment = (await runtimeValue("SECUREVISIT_ENVIRONMENT")) === "development";
    const validEndpoint = (candidate: string) => {
      try {
        const parsed = new URL(candidate);
        const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
        return parsed.protocol === "https:" || (isLocalDevelopment && localHttp);
      } catch {
        return false;
      }
    };
    if (!url || !validEndpoint(url) || !refundUrl || !validEndpoint(refundUrl) || !secret) return null;
    return new WebhookCheckoutProvider(url, refundUrl, secret);
  }
  return null;
}

class LocalDevelopmentPaymentProvider implements PaymentProvider {
  readonly name = "local_test";

  async createCheckout(input: { paymentIntentId: string }): Promise<PaymentCheckout> {
    return { provider: "local_test", providerReference: `local-payment-${input.paymentIntentId}`, checkoutUrl: null };
  }

  async requestRefund(input: { paymentIntentId: string }): Promise<PaymentRefundRequest> {
    return { provider: "local_test", providerReference: `local-refund-${input.paymentIntentId}` };
  }
}

class WebhookCheckoutProvider implements PaymentProvider {
  readonly name = "webhook";

  constructor(private readonly url: string, private readonly refundUrl: string, private readonly secret: string) {}

  async createCheckout(input: { paymentIntentId: string; email: string | null; phone: string | null; creditQuantity: number; amountMinor: number; currency: string; successUrl?: string; cancelUrl?: string }): Promise<PaymentCheckout> {
    if (!input.email && !input.phone) throw new Error("PAYMENT_CONTACT_REQUIRED");
    const payload = JSON.stringify(input);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(this.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
    const signature = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": input.paymentIntentId, "x-securevisit-timestamp": timestamp, "x-securevisit-signature": `sha256=${signature}` }, body: payload, signal: controller.signal });
      if (!response.ok) throw new Error(`PAYMENT_CHECKOUT_FAILED_${response.status}`);
      const result = await response.json() as { providerReference?: unknown; checkoutUrl?: unknown };
      if (typeof result.providerReference !== "string" || !result.providerReference || (result.checkoutUrl !== null && typeof result.checkoutUrl !== "string")) throw new Error("PAYMENT_CHECKOUT_INVALID_RESPONSE");
      const checkoutUrl = result.checkoutUrl as string | null;
      if (checkoutUrl) {
        let parsed: URL;
        try { parsed = new URL(checkoutUrl); } catch { throw new Error("PAYMENT_CHECKOUT_INVALID_URL"); }
        const isLocalDevelopment = (await runtimeValue("SECUREVISIT_ENVIRONMENT")) === "development" && parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
        if (parsed.protocol !== "https:" && !isLocalDevelopment) throw new Error("PAYMENT_CHECKOUT_INVALID_URL");
      }
      return { provider: "webhook", providerReference: result.providerReference, checkoutUrl };
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestRefund(input: { paymentIntentId: string; providerReference: string; amountMinor: number; currency: string; reason: string }): Promise<PaymentRefundRequest> {
    const payload = JSON.stringify(input);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(this.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
    const signature = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(this.refundUrl, { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": `refund:${input.paymentIntentId}`, "x-securevisit-timestamp": timestamp, "x-securevisit-signature": `sha256=${signature}` }, body: payload, signal: controller.signal });
      if (!response.ok) throw new Error(`PAYMENT_REFUND_REQUEST_FAILED_${response.status}`);
      const result = await response.json() as { providerReference?: unknown; refundReference?: unknown };
      const providerReference = typeof result.refundReference === "string" && result.refundReference.trim()
        ? result.refundReference.trim()
        : typeof result.providerReference === "string" && result.providerReference.trim() ? result.providerReference.trim() : "";
      if (!providerReference) throw new Error("PAYMENT_REFUND_INVALID_RESPONSE");
      return { provider: "webhook", providerReference };
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

export async function verifyPaymentWebhookSignature(
  payload: string,
  suppliedSignature: string | null,
  secret: string | null,
  timestampHeader: string | null = null,
  nowMs = Date.now(),
  maxAgeSeconds = 300,
): Promise<boolean> {
  if (!secret || !suppliedSignature) return false;
  let signedPayload = payload;
  if (timestampHeader !== null) {
    const timestamp = timestampHeader.trim();
    const timestampSeconds = Number(timestamp);
    if (!/^\d{10}$/.test(timestamp) || !Number.isSafeInteger(timestampSeconds)) return false;
    const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds);
    if (ageSeconds > maxAgeSeconds) return false;
    signedPayload = `${timestamp}.${payload}`;
  }
  const normalized = suppliedSignature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
  const signature = new Uint8Array(32);
  for (let index = 0; index < signature.length; index += 1) {
    signature[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(signedPayload));
}
