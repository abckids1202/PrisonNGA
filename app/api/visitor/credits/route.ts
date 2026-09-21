import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const accounts = await d1.prepare(`SELECT ca.id, ca.facility_id, f.name AS facility_name, ca.available_credits, ca.reserved_credits, ca.version, ca.updated_at FROM credit_accounts ca INNER JOIN facilities f ON f.id = ca.facility_id WHERE ca.user_id = ? ORDER BY f.name`).bind(visitor.userId).all();
    const ledger = await d1.prepare(`SELECT cle.id, cle.credit_account_id, cle.appointment_id, cle.entry_type, cle.amount, cle.reason, cle.created_at FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca.id = cle.credit_account_id WHERE ca.user_id = ? ORDER BY cle.created_at DESC LIMIT 50`).bind(visitor.userId).all();
    return securityResponse({ accounts: accounts.results, ledger: ledger.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
