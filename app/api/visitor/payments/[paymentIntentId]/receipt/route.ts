import { getD1 } from "../../../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";

export async function GET(_request: Request, { params }: { params: Promise<{ paymentIntentId: string }> }) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const { paymentIntentId } = await params;
    if (!paymentIntentId || paymentIntentId.length > 128) throw new SecurityError("PAYMENT_RECEIPT_NOT_FOUND", 404);
    const d1 = await getD1();
    const payment = await d1.prepare(`SELECT pi.id, pi.facility_id, f.name AS facility_name, pi.provider, pi.provider_reference, pi.credit_quantity, pi.amount_minor, pi.currency, pi.status, pi.created_at, pi.updated_at,
      cle.id AS ledger_entry_id, cle.created_at AS settled_at
      FROM payment_intents pi
      INNER JOIN facilities f ON f.id = pi.facility_id
      LEFT JOIN credit_ledger_entries cle ON cle.idempotency_key = 'payment:' || pi.id || ':purchase' AND cle.entry_type = 'PURCHASE'
      WHERE pi.id = ? AND pi.user_id = ? AND pi.status = 'SUCCEEDED'
      LIMIT 1`).bind(paymentIntentId, visitor.userId).first<Record<string, string | number | null>>();
    if (!payment || !payment.ledger_entry_id) throw new SecurityError("PAYMENT_RECEIPT_NOT_FOUND", 404);
    return securityResponse({ receipt: {
      receiptId: `SV-${payment.id}`,
      paymentIntentId: payment.id,
      facilityId: payment.facility_id,
      facilityName: payment.facility_name,
      provider: payment.provider,
      providerReference: payment.provider_reference,
      creditQuantity: Number(payment.credit_quantity),
      amountMinor: Number(payment.amount_minor),
      currency: payment.currency,
      status: "PAID",
      issuedAt: payment.settled_at || payment.updated_at || payment.created_at,
    } }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
