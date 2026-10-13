export type PaymentCheckout = { provider: string; providerReference: string; checkoutUrl: string | null };
export type PaymentRefundRequest = { provider: string; providerReference: string };
import { isSecureEndpoint } from "../endpoint";
import { readBoundedResponseText } from "../bounded-response";

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
  const environment = await runtimeValue("SECUREVISIT_ENVIRONMENT");
  // A fresh local checkout may still have the non-production `none` value.
  // Keep development runnable, but never allow this fallback outside the
  // explicitly selected development environment.
  if ((!provider || provider === "none" || provider === "console") && environment === "development") return new LocalDevelopmentPaymentProvider();
  if (!provider || provider === "none" || provider === "console") return null;
  // This deterministic adapter exists only for local acceptance tests; staging
  // and production environment validation require the signed webhook adapter.
  if (provider === "local_test") {
    return environment === "development" ? new LocalDevelopmentPaymentProvider() : null;
  }
  if (provider === "webhook") {
    const url = await runtimeValue("PAYMENT_CHECKOUT_URL");
    const refundUrl = await runtimeValue("PAYMENT_REFUND_URL");
    const secret = await runtimeValue("PAYMENT_PROVIDER_SECRET");
    const isLocalDevelopment = (await runtimeValue("SECUREVISIT_ENVIRONMENT")) === "development";
    if (!url || !isSecureEndpoint(url, { allowLocalHttp: isLocalDevelopment }) || !refundUrl || !isSecureEndpoint(refundUrl, { allowLocalHttp: isLocalDevelopment }) || !secret) return null;
    return new WebhookCheckoutProvider(url, refundUrl, secret);
  }
  if (provider === "xendit") {
    const secretKey = await runtimeValue("XENDIT_SECRET_KEY");
    const apiBaseUrl = (await runtimeValue("XENDIT_API_BASE_URL")) || "https://api.xendit.co";
    const isLocalDevelopment = environment === "development";
    if (!secretKey || !isSecureEndpoint(apiBaseUrl, { allowLocalHttp: isLocalDevelopment })) return null;
    return new XenditPaymentProvider(apiBaseUrl, secretKey);
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
      const responseText = await readBoundedResponseText(response);
      let result: { providerReference?: unknown; checkoutUrl?: unknown };
      try { result = JSON.parse(responseText) as { providerReference?: unknown; checkoutUrl?: unknown }; }
      catch { throw new Error("PAYMENT_CHECKOUT_INVALID_RESPONSE"); }
      if (typeof result.providerReference !== "string" || !result.providerReference || (result.checkoutUrl !== null && typeof result.checkoutUrl !== "string")) throw new Error("PAYMENT_CHECKOUT_INVALID_RESPONSE");
      const checkoutUrl = result.checkoutUrl as string | null;
      if (checkoutUrl) {
        let parsed: URL;
        try { parsed = new URL(checkoutUrl); } catch { throw new Error("PAYMENT_CHECKOUT_INVALID_URL"); }
        const isLocalDevelopment = (await runtimeValue("SECUREVISIT_ENVIRONMENT")) === "development" && parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
        if (!isSecureEndpoint(checkoutUrl, { allowLocalHttp: isLocalDevelopment })) throw new Error("PAYMENT_CHECKOUT_INVALID_URL");
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
      const responseText = await readBoundedResponseText(response);
      let result: { providerReference?: unknown; refundReference?: unknown };
      try { result = JSON.parse(responseText) as { providerReference?: unknown; refundReference?: unknown }; }
      catch { throw new Error("PAYMENT_REFUND_INVALID_RESPONSE"); }
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

type XenditSessionResponse = {
  payment_session_id?: unknown;
  payment_request_id?: unknown;
  payment_link_url?: unknown;
};

/**
 * Xendit hosted-checkout adapter. The SecureVisit payment intent remains the
 * merchant reference; provider webhooks must still be normalized into the
 * canonical /api/webhooks/payments contract before settlement.
 */
class XenditPaymentProvider implements PaymentProvider {
  readonly name = "xendit";

  constructor(private readonly apiBaseUrl: string, private readonly secretKey: string) {}

  private authorizationHeader(): string {
    return `Basic ${btoa(`${this.secretKey}:`)}`;
  }

  private async request(path: string, init: RequestInit): Promise<{ response: Response; text: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${this.apiBaseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: this.authorizationHeader(),
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      // Keep the deadline active through bounded body consumption. A provider
      // that sends headers and then stalls must not bypass the adapter timeout.
      const text = await readBoundedResponseText(response);
      return { response, text };
    } finally {
      clearTimeout(timeout);
    }
  }

  async createCheckout(input: { paymentIntentId: string; email: string | null; phone: string | null; creditQuantity: number; amountMinor: number; currency: string; successUrl?: string; cancelUrl?: string }): Promise<PaymentCheckout> {
    if (!input.email && !input.phone) throw new Error("PAYMENT_CONTACT_REQUIRED");
    if (!input.successUrl || !input.cancelUrl) throw new Error("PAYMENT_RETURN_URL_REQUIRED");
    const requestResult = await this.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference_id: input.paymentIntentId,
        session_type: "PAY",
        mode: "PAYMENT_LINK",
        amount: input.amountMinor,
        currency: input.currency,
        country: "ID",
        locale: "en",
        customer: {
          reference_id: `visitor${input.paymentIntentId.replaceAll("-", "")}`,
          type: "INDIVIDUAL",
          ...(input.email ? { email: input.email } : {}),
          ...(input.phone ? { mobile_number: input.phone } : {}),
        },
        items: [{
          reference_id: `credit${input.paymentIntentId.replaceAll("-", "")}`,
          name: `${input.creditQuantity} SecureVisit Visit Credit${input.creditQuantity === 1 ? "" : "s"}`,
          type: "DIGITAL_SERVICE",
          net_unit_amount: input.amountMinor,
          quantity: 1,
          currency: input.currency,
        }],
        description: `SecureVisit Visit Credit purchase ${input.paymentIntentId}`,
        success_return_url: input.successUrl,
        cancel_return_url: input.cancelUrl,
      }),
    });
    const { response, text } = requestResult;
    if (!response.ok) throw new Error(`PAYMENT_CHECKOUT_FAILED_${response.status}`);
    let result: XenditSessionResponse;
    try { result = JSON.parse(text) as XenditSessionResponse; } catch { throw new Error("PAYMENT_CHECKOUT_INVALID_RESPONSE"); }
    const sessionId = typeof result.payment_session_id === "string" ? result.payment_session_id.trim() : "";
    const checkoutUrl = typeof result.payment_link_url === "string" ? result.payment_link_url.trim() : "";
    if (!sessionId || !checkoutUrl) throw new Error("PAYMENT_CHECKOUT_INVALID_RESPONSE");
    if (!isSecureEndpoint(checkoutUrl)) throw new Error("PAYMENT_CHECKOUT_INVALID_URL");
    return { provider: this.name, providerReference: sessionId, checkoutUrl };
  }

  async requestRefund(input: { paymentIntentId: string; providerReference: string; amountMinor: number; currency: string; reason: string }): Promise<PaymentRefundRequest> {
    // SecureVisit stores the session ID at checkout time. Xendit requires the
    // payment_request_id for refunds, so resolve the completed session first.
    const sessionResult = await this.request(`/sessions/${encodeURIComponent(input.providerReference)}`, { method: "GET" });
    const { response: sessionResponse, text: sessionText } = sessionResult;
    if (!sessionResponse.ok) throw new Error(`PAYMENT_SESSION_LOOKUP_FAILED_${sessionResponse.status}`);
    let session: XenditSessionResponse;
    try { session = JSON.parse(sessionText) as XenditSessionResponse; } catch { throw new Error("PAYMENT_SESSION_INVALID_RESPONSE"); }
    const paymentRequestId = typeof session.payment_request_id === "string" ? session.payment_request_id.trim() : "";
    if (!paymentRequestId) throw new Error("PAYMENT_REQUEST_NOT_AVAILABLE");
    const refundResult = await this.request("/refunds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference_id: input.paymentIntentId,
        payment_request_id: paymentRequestId,
        currency: input.currency,
        amount: input.amountMinor,
        reason: input.reason.toUpperCase().includes("CANCEL") ? "CANCELLATION" : "REQUESTED_BY_CUSTOMER",
      }),
    });
    const { response: refundResponse, text: refundText } = refundResult;
    if (!refundResponse.ok) throw new Error(`PAYMENT_REFUND_REQUEST_FAILED_${refundResponse.status}`);
    let refund: { id?: unknown };
    try { refund = JSON.parse(refundText) as { id?: unknown }; } catch { throw new Error("PAYMENT_REFUND_INVALID_RESPONSE"); }
    const refundId = typeof refund.id === "string" ? refund.id.trim() : "";
    if (!refundId) throw new Error("PAYMENT_REFUND_INVALID_RESPONSE");
    return { provider: this.name, providerReference: refundId };
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
