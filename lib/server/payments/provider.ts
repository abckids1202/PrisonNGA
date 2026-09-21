export type PaymentCheckout = { provider: string; providerReference: string; checkoutUrl: string | null };

export type PaymentWebhook = { eventId: string; eventType: string; paymentIntentId?: string; providerReference?: string; status?: string };

export interface PaymentProvider {
  createCheckout(input: { paymentIntentId: string; email: string; creditQuantity: number; amountMinor: number; currency: string }): Promise<PaymentCheckout>;
}

export async function getPaymentProvider(): Promise<PaymentProvider | null> {
  let provider = "";
  try {
    const { env } = await import("cloudflare:workers");
    provider = String((env as unknown as Record<string, unknown>).PAYMENT_PROVIDER || "").toLowerCase();
  } catch {
    provider = typeof process !== "undefined" ? String(process.env.PAYMENT_PROVIDER || "").toLowerCase() : "";
  }
  if (!provider || provider === "none" || provider === "console") return null;
  return null;
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
