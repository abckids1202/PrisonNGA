import { getD1 } from "../../../../db/runtime";
import { getPaymentProvider } from "../../../../lib/server/payments/provider";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const CREDIT_PRICE_MINOR = 50000;

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    const body = await request.json() as { facilityId?: unknown; creditQuantity?: unknown };
    const facilityId = typeof body.facilityId === "string" ? body.facilityId.trim() : "";
    const creditQuantity = Number(body.creditQuantity);
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    if (!facilityId || !Number.isInteger(creditQuantity) || creditQuantity < 1 || creditQuantity > 20) throw new SecurityError("INVALID_CREDIT_PURCHASE", 400);
    const d1 = await getD1();
    const existing = await d1.prepare("SELECT id, status, provider, checkout_url, amount_minor, credit_quantity FROM payment_intents WHERE idempotency_key = ? AND user_id = ?").bind(idempotencyKey, visitor.userId).first<Record<string, string | number | null>>();
    if (existing) return securityResponse({ paymentIntent: existing, idempotent: true }, 200, context.requestId);
    const facility = await d1.prepare("SELECT id FROM facilities WHERE id = ?").bind(facilityId).first<{ id: string }>();
    if (!facility) throw new SecurityError("FACILITY_NOT_FOUND", 404);
    const paymentIntentId = crypto.randomUUID();
    const amountMinor = creditQuantity * CREDIT_PRICE_MINOR;
    const now = new Date().toISOString();
    await d1.prepare(`INSERT INTO payment_intents (id, facility_id, user_id, provider, credit_quantity, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, 'UNCONFIGURED', ?, ?, 'IDR', 'PENDING', ?, 1, ?, ?)`).bind(paymentIntentId, facilityId, visitor.userId, creditQuantity, amountMinor, idempotencyKey, now, now).run();
    const provider = await getPaymentProvider();
    if (!provider) throw new SecurityError("PAYMENT_PROVIDER_NOT_CONFIGURED", 503);
    const checkout = await provider.createCheckout({ paymentIntentId, email: visitor.email, creditQuantity, amountMinor, currency: "IDR" });
    await d1.prepare("UPDATE payment_intents SET provider = ?, provider_reference = ?, checkout_url = ?, status = 'CHECKOUT_CREATED', updated_at = ?, version = version + 1 WHERE id = ?").bind(checkout.provider, checkout.providerReference, checkout.checkoutUrl, new Date().toISOString(), paymentIntentId).run();
    return securityResponse({ paymentIntent: { id: paymentIntentId, status: "CHECKOUT_CREATED", checkoutUrl: checkout.checkoutUrl, creditQuantity, amountMinor, currency: "IDR" } }, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT id, facility_id, provider, credit_quantity, amount_minor, currency, status, provider_reference, checkout_url, version, created_at, updated_at FROM payment_intents WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).bind(visitor.userId).all();
    return securityResponse({ paymentIntents: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
