import { getD1 } from "../../../../../db/runtime";
import { enforceRateLimit } from "../../../../../lib/server/rate-limit";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

export async function GET(_request: Request, { params }: { params: Promise<{ paymentIntentId: string }> }) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const { paymentIntentId } = await params;
    if (!/^[A-Za-z0-9-]{8,128}$/.test(paymentIntentId || "")) throw new SecurityError("PAYMENT_NOT_FOUND", 404);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `payment-status:${visitor.userId}`, limit: 120, windowSeconds: 60 * 10 });
    const payment = await d1.prepare(`SELECT pi.id, pi.facility_id, pi.provider, pi.provider_reference, pi.credit_quantity, pi.amount_minor, pi.currency, pi.status, pi.checkout_url, pi.created_at, pi.updated_at,
      EXISTS (SELECT 1 FROM credit_ledger_entries cle WHERE cle.idempotency_key = 'payment:' || pi.id || ':purchase' AND cle.entry_type = 'PURCHASE') AS settled
      FROM payment_intents pi WHERE pi.id = ? AND pi.user_id = ? LIMIT 1`).bind(paymentIntentId, visitor.userId).first<Record<string, string | number | null>>();
    if (!payment) throw new SecurityError("PAYMENT_NOT_FOUND", 404);
    return securityResponse({ paymentIntent: {
      id: payment.id,
      facilityId: payment.facility_id,
      provider: payment.provider,
      providerReference: payment.provider_reference,
      creditQuantity: Number(payment.credit_quantity),
      amountMinor: Number(payment.amount_minor),
      currency: payment.currency,
      status: payment.status,
      checkoutUrl: payment.checkout_url,
      settled: Number(payment.settled) === 1,
      createdAt: payment.created_at,
      updatedAt: payment.updated_at,
    } }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
