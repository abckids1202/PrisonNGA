import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { getPaymentProvider } from "../../../../lib/server/payments/provider";
import { getRequestContext, getRuntimeValue, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";
import { safeOperationalErrorMessage } from "../../../../lib/server/observability";
import { isSecureHttpsEndpoint } from "../../../../lib/server/endpoint";

const DEMO_CREDIT_PRICE_MINOR = 50000;

async function getPublicAppOrigin(request: Request): Promise<string> {
  const environment = (await getRuntimeValue("SECUREVISIT_ENVIRONMENT") || "development").toLowerCase();
  if (environment === "development") return new URL(request.url).origin;
  const configured = (await getRuntimeValue("PUBLIC_APP_URL") || "").trim();
  if (!isSecureHttpsEndpoint(configured)) throw new SecurityError("PUBLIC_APP_URL_NOT_CONFIGURED", 503);
  return new URL(configured).origin;
}

type CreditPricing = { perCreditMinor: number; currency: "IDR"; demo: boolean };

async function getCreditPricing(d1: D1Database, facilityId: string): Promise<CreditPricing> {
  const policy = await d1.prepare("SELECT credit_price_minor, credit_currency FROM visit_policies WHERE facility_id = ?").bind(facilityId).first<{ credit_price_minor: number | null; credit_currency: string }>();
  if (policy && Number.isSafeInteger(policy.credit_price_minor) && Number(policy.credit_price_minor) > 0 && policy.credit_currency === "IDR") {
    return { perCreditMinor: Number(policy.credit_price_minor), currency: "IDR", demo: false };
  }
  const configured = Number(await getRuntimeValue("VISIT_CREDIT_PRICE_MINOR"));
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT");
  // Development fallback keeps an empty local database usable, but it is
  // intentionally impossible outside development. Staging/production must
  // configure the approved tariff on the facility policy record.
  if (environment === "development" && Number.isSafeInteger(configured) && configured > 0) return { perCreditMinor: configured, currency: "IDR", demo: true };
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
    let existing = await d1.prepare("SELECT id, facility_id, status, provider, checkout_url, amount_minor, credit_quantity, currency, version FROM payment_intents WHERE idempotency_key IN (?, ?) AND user_id = ? LIMIT 1").bind(storedIdempotencyKey, idempotencyKey, visitor.userId).first<Record<string, string | number | null>>();
    if (existing && (existing.facility_id !== facilityId || Number(existing.credit_quantity) !== creditQuantity)) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
    if (existing && ["CHECKOUT_CREATED", "SUCCEEDED", "REFUNDED", "DISPUTED"].includes(String(existing.status))) {
      return securityResponse({ paymentIntent: existing, idempotent: true }, 200, context.requestId);
    }
    // Revalidate operational state on retries as well as first checkout. A
    // pending or failed intent must not become payable after the facility has
    // entered lockdown or another restricted state.
    const facility = await d1.prepare("SELECT id FROM facilities WHERE id = ? AND current_state = 'NORMAL_OPERATIONS'").bind(facilityId).first<{ id: string }>();
    if (!facility) throw new SecurityError("FACILITY_NOT_AVAILABLE", 409);
    const provider = await getPaymentProvider();
    if (!provider) throw new SecurityError("PAYMENT_PROVIDER_NOT_CONFIGURED", 503);
    const publicAppOrigin = await getPublicAppOrigin(request);
    let paymentIntentId = String(existing?.id || crypto.randomUUID());
    const pricing = existing ? null : await getCreditPricing(d1, facilityId);
    let amountMinor = Number(existing?.amount_minor || creditQuantity * (pricing?.perCreditMinor || 0));
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new SecurityError("CREDIT_PRICE_INVALID", 503);
    if (!existing) {
      const now = new Date().toISOString();
      const created = await d1.prepare(`INSERT OR IGNORE INTO payment_intents (id, facility_id, user_id, provider, credit_quantity, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'IDR', 'PENDING', ?, 1, ?, ?)`).bind(paymentIntentId, facilityId, visitor.userId, provider.name, creditQuantity, amountMinor, storedIdempotencyKey, now, now).run();
      if (!created.meta.changes) {
        existing = await d1.prepare("SELECT id, facility_id, status, provider, checkout_url, amount_minor, credit_quantity, currency, version FROM payment_intents WHERE idempotency_key = ? AND user_id = ?").bind(storedIdempotencyKey, visitor.userId).first<Record<string, string | number | null>>();
        if (!existing || existing.facility_id !== facilityId || Number(existing.credit_quantity) !== creditQuantity) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
        paymentIntentId = String(existing.id);
        amountMinor = Number(existing.amount_minor);
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new SecurityError("CREDIT_PRICE_INVALID", 503);
        if (["CHECKOUT_CREATED", "SUCCEEDED", "REFUNDED", "DISPUTED"].includes(String(existing.status))) return securityResponse({ paymentIntent: existing, idempotent: true }, 200, context.requestId);
      }
    }
    const claimVersion = Number(existing?.version || 1);
    const claim = await d1.prepare("UPDATE payment_intents SET version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status IN ('PENDING', 'FAILED', 'EXPIRED')")
      .bind(new Date().toISOString(), paymentIntentId, claimVersion)
      .run();
    if (!claim.meta.changes) {
      const current = await d1.prepare("SELECT id, facility_id, status, provider, checkout_url, amount_minor, credit_quantity, currency, version FROM payment_intents WHERE id = ? AND user_id = ?")
        .bind(paymentIntentId, visitor.userId)
        .first<Record<string, string | number | null>>();
      if (current && ["CHECKOUT_CREATED", "SUCCEEDED", "REFUNDED", "DISPUTED"].includes(String(current.status))) {
        return securityResponse({ paymentIntent: current, idempotent: true }, 200, context.requestId);
      }
      throw new SecurityError("PAYMENT_CHECKOUT_IN_PROGRESS", 409);
    }
    let checkout;
    try {
      checkout = await provider.createCheckout({
        paymentIntentId,
        email: visitor.email,
        phone: visitor.phone,
        creditQuantity,
        amountMinor,
        currency: "IDR",
        successUrl: `${publicAppOrigin}/visitor/payment/${encodeURIComponent(paymentIntentId)}?result=success`,
        cancelUrl: `${publicAppOrigin}/visitor/payment/${encodeURIComponent(paymentIntentId)}?result=cancelled`,
      });
    } catch (error) {
      const now = new Date().toISOString();
      const message = safeOperationalErrorMessage(error, "PAYMENT_CHECKOUT_FAILED");
      const failureWrites = await d1.batch([
        d1.prepare("UPDATE payment_intents SET status = 'FAILED', updated_at = ?, version = version + 1 WHERE id = ? AND status IN ('PENDING', 'FAILED', 'EXPIRED')").bind(now, paymentIntentId),
        ...auditAndOutboxStatements(d1, { actorUserId: visitor.userId, actorRole: "Visitor", facilityId, actionType: "PAYMENT_CHECKOUT_FAILED", entityType: "payment_intent", entityId: paymentIntentId, reason: "Payment checkout provider failed.", oldValues: { status: "PENDING", creditQuantity, amountMinor, currency: "IDR" }, newValues: { status: "FAILED", error: message }, requestId: context.requestId, eventType: "PAYMENT_CHECKOUT_FAILED", payload: { paymentIntentId, creditQuantity, amountMinor, currency: "IDR", error: message } }, { sql: "EXISTS (SELECT 1 FROM payment_intents WHERE id = ? AND status = 'FAILED')", values: [paymentIntentId] }),
      ]);
      if (!failureWrites.every((result) => Boolean(result?.meta.changes))) throw new SecurityError("PAYMENT_CHECKOUT_FAILURE_NOT_PERSISTED", 503);
      throw error;
    }
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const updated = await d1.batch([
      d1.prepare("UPDATE payment_intents SET provider = ?, provider_reference = ?, checkout_url = ?, status = 'CHECKOUT_CREATED', updated_at = ?, version = version + 1 WHERE id = ? AND status IN ('PENDING', 'FAILED', 'EXPIRED')").bind(checkout.provider, checkout.providerReference, checkout.checkoutUrl, now, paymentIntentId),
      ...auditAndOutboxStatements(d1, { actorUserId: visitor.userId, actorRole: "Visitor", facilityId, actionType: "PAYMENT_CHECKOUT_CREATED", entityType: "payment_intent", entityId: paymentIntentId, reason: "Visitor started a visit credit checkout.", oldValues: { status: "PENDING", creditQuantity, amountMinor, currency: "IDR" }, newValues: { status: "CHECKOUT_CREATED", provider: checkout.provider, providerReference: checkout.providerReference }, requestId: context.requestId, correlationId, eventType: "PAYMENT_CHECKOUT_CREATED", payload: { paymentIntentId, provider: checkout.provider, providerReference: checkout.providerReference, creditQuantity, amountMinor, currency: "IDR" } }, { sql: "EXISTS (SELECT 1 FROM payment_intents WHERE id = ? AND status = 'CHECKOUT_CREATED' AND provider_reference = ?)", values: [paymentIntentId, checkout.providerReference] }),
    ]);
    if (!updated.every((result) => Boolean(result?.meta.changes))) {
      const current = await d1.prepare("SELECT id, status, provider, checkout_url, amount_minor, credit_quantity, currency FROM payment_intents WHERE id = ? AND user_id = ?").bind(paymentIntentId, visitor.userId).first<Record<string, string | number | null>>();
      if (!current) throw new SecurityError("PAYMENT_INTENT_NOT_FOUND", 503);
      return securityResponse({ paymentIntent: current, idempotent: true }, 200, context.requestId);
    }
    return securityResponse({ paymentIntent: { id: paymentIntentId, status: "CHECKOUT_CREATED", checkoutUrl: checkout.checkoutUrl, creditQuantity, amountMinor, currency: "IDR" }, correlationId }, existing ? 200 : 201, context.requestId);
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
    const pricingRows = await d1.prepare(`SELECT f.id AS facility_id, vp.credit_price_minor, vp.credit_currency
      FROM facilities f INNER JOIN visit_policies vp ON vp.facility_id = f.id
      WHERE f.current_state = 'NORMAL_OPERATIONS'`).all<{ facility_id: string; credit_price_minor: number | null; credit_currency: string }>();
    const pricingByFacility: Record<string, CreditPricing> = {};
    for (const row of pricingRows.results) {
      try { pricingByFacility[row.facility_id] = await getCreditPricing(d1, row.facility_id); } catch { /* Unpriced facilities remain unavailable. */ }
    }
    const pricing = Object.values(pricingByFacility)[0] || null;
    let checkoutUnavailableReason: string | null = pricing ? null : "VISIT_CREDIT_PRICE_NOT_CONFIGURED";
    if (!provider) checkoutUnavailableReason = "PAYMENT_PROVIDER_NOT_CONFIGURED";
    return securityResponse({ paymentIntents: result.results, pricing, pricingByFacility, checkoutAvailable: Boolean(provider && pricing), checkoutUnavailableReason }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
