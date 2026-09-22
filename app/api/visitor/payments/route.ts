import { getD1 } from "../../../../db/runtime";
import { getPaymentProvider } from "../../../../lib/server/payments/provider";
import { getRequestContext, getRuntimeValue, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";

const DEMO_CREDIT_PRICE_MINOR = 50000;

async function getCreditPricing() {
  const configured = Number(await getRuntimeValue("VISIT_CREDIT_PRICE_MINOR"));
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT");
  if (Number.isSafeInteger(configured) && configured > 0) return { perCreditMinor: configured, currency: "IDR", demo: environment === "development" };
  if (environment === "development") return { perCreditMinor: DEMO_CREDIT_PRICE_MINOR, currency: "IDR", demo: true };
  throw new SecurityError("VISIT_CREDIT_PRICE_NOT_CONFIGURED", 503);
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    const body = await request.json() as { facilityId?: unknown; creditQuantity?: unknown };
    const facilityId = typeof body.facilityId === "string" ? body.facilityId.trim() : "";
    const creditQuantity = Number(body.creditQuantity);
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const storedIdempotencyKey = `${visitor.userId}:${idempotencyKey}`;
    if (!facilityId || !Number.isInteger(creditQuantity) || creditQuantity < 1 || creditQuantity > 20) throw new SecurityError("INVALID_CREDIT_PURCHASE", 400);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `payment-create:${visitor.userId}`, limit: 10, windowSeconds: 60 * 60 });
    let existing = await d1.prepare("SELECT id, facility_id, status, provider, checkout_url, amount_minor, credit_quantity, currency FROM payment_intents WHERE idempotency_key IN (?, ?) AND user_id = ? LIMIT 1").bind(storedIdempotencyKey, idempotencyKey, visitor.userId).first<Record<string, string | number | null>>();
    if (existing && (existing.facility_id !== facilityId || Number(existing.credit_quantity) !== creditQuantity)) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
    if (existing && ["CHECKOUT_CREATED", "SUCCEEDED", "REFUNDED", "DISPUTED"].includes(String(existing.status))) {
      return securityResponse({ paymentIntent: existing, idempotent: true }, 200, context.requestId);
    }
    const facility = existing ? { id: facilityId } : await d1.prepare("SELECT id FROM facilities WHERE id = ? AND current_state = 'NORMAL_OPERATIONS'").bind(facilityId).first<{ id: string }>();
    if (!facility) throw new SecurityError("FACILITY_NOT_AVAILABLE", 409);
    const provider = await getPaymentProvider();
    if (!provider) throw new SecurityError("PAYMENT_PROVIDER_NOT_CONFIGURED", 503);
    let paymentIntentId = String(existing?.id || crypto.randomUUID());
    const pricing = existing ? null : await getCreditPricing();
    let amountMinor = Number(existing?.amount_minor || creditQuantity * (pricing?.perCreditMinor || 0));
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new SecurityError("CREDIT_PRICE_INVALID", 503);
    if (!existing) {
      const now = new Date().toISOString();
      const created = await d1.prepare(`INSERT OR IGNORE INTO payment_intents (id, facility_id, user_id, provider, credit_quantity, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, 'webhook', ?, ?, 'IDR', 'PENDING', ?, 1, ?, ?)`).bind(paymentIntentId, facilityId, visitor.userId, creditQuantity, amountMinor, storedIdempotencyKey, now, now).run();
      if (!created.meta.changes) {
        existing = await d1.prepare("SELECT id, facility_id, status, provider, checkout_url, amount_minor, credit_quantity, currency FROM payment_intents WHERE idempotency_key = ? AND user_id = ?").bind(storedIdempotencyKey, visitor.userId).first<Record<string, string | number | null>>();
        if (!existing || existing.facility_id !== facilityId || Number(existing.credit_quantity) !== creditQuantity) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
        paymentIntentId = String(existing.id);
        amountMinor = Number(existing.amount_minor);
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new SecurityError("CREDIT_PRICE_INVALID", 503);
        if (["CHECKOUT_CREATED", "SUCCEEDED", "REFUNDED", "DISPUTED"].includes(String(existing.status))) return securityResponse({ paymentIntent: existing, idempotent: true }, 200, context.requestId);
      }
    }
    let checkout;
    try {
      checkout = await provider.createCheckout({ paymentIntentId, email: visitor.email, creditQuantity, amountMinor, currency: "IDR" });
    } catch (error) {
      await d1.prepare("UPDATE payment_intents SET status = 'FAILED', updated_at = ?, version = version + 1 WHERE id = ? AND status IN ('PENDING', 'FAILED', 'EXPIRED')").bind(new Date().toISOString(), paymentIntentId).run();
      throw error;
    }
    const updated = await d1.prepare("UPDATE payment_intents SET provider = ?, provider_reference = ?, checkout_url = ?, status = 'CHECKOUT_CREATED', updated_at = ?, version = version + 1 WHERE id = ? AND status IN ('PENDING', 'FAILED', 'EXPIRED')").bind(checkout.provider, checkout.providerReference, checkout.checkoutUrl, new Date().toISOString(), paymentIntentId).run();
    if (!updated.meta.changes) {
      const current = await d1.prepare("SELECT id, status, provider, checkout_url, amount_minor, credit_quantity, currency FROM payment_intents WHERE id = ? AND user_id = ?").bind(paymentIntentId, visitor.userId).first<Record<string, string | number | null>>();
      if (!current) throw new SecurityError("PAYMENT_INTENT_NOT_FOUND", 503);
      return securityResponse({ paymentIntent: current, idempotent: true }, 200, context.requestId);
    }
    return securityResponse({ paymentIntent: { id: paymentIntentId, status: "CHECKOUT_CREATED", checkoutUrl: checkout.checkoutUrl, creditQuantity, amountMinor, currency: "IDR" } }, existing ? 200 : 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const [result, provider] = await Promise.all([
      d1.prepare(`SELECT id, facility_id, provider, credit_quantity, amount_minor, currency, status, provider_reference, checkout_url, version, created_at, updated_at FROM payment_intents WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).bind(visitor.userId).all(),
      getPaymentProvider(),
    ]);
    let pricing: Awaited<ReturnType<typeof getCreditPricing>> | null = null;
    let checkoutUnavailableReason: string | null = null;
    try {
      pricing = await getCreditPricing();
    } catch (error) {
      if (!(error instanceof SecurityError) || error.code !== "VISIT_CREDIT_PRICE_NOT_CONFIGURED") throw error;
      checkoutUnavailableReason = "VISIT_CREDIT_PRICE_NOT_CONFIGURED";
    }
    if (!provider) checkoutUnavailableReason = "PAYMENT_PROVIDER_NOT_CONFIGURED";
    return securityResponse({ paymentIntents: result.results, pricing, checkoutAvailable: Boolean(provider && pricing), checkoutUnavailableReason }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
