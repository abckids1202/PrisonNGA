export type PaymentCheckout = { provider: string; providerReference: string; checkoutUrl: string | null };

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
