import { getD1 } from "../../../../db/runtime";
import { financeLedgerStatement, financePaymentsStatement, financeSummaryStatement } from "../../../../lib/server/finance-directory";
import { getPaymentProvider } from "../../../../lib/server/payments/provider";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("finance.read");
    const d1 = await getD1();
    const [summary, ledger, payments, provider] = await Promise.all([
      financeSummaryStatement(d1, authorization.facilityId).first(),
      financeLedgerStatement(d1, authorization.facilityId).all(),
      financePaymentsStatement(d1, authorization.facilityId).all(),
      getPaymentProvider(),
    ]);
    return securityResponse({
      facilityId: authorization.facilityId,
      summary: summary || {},
      ledger: ledger.results || [],
      payments: payments.results || [],
      providerConfigured: Boolean(provider),
      reconciliation: { available: false, reason: "RECONCILIATION_WORKER_NOT_CONFIGURED" },
    }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
