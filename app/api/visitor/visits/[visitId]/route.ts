import { getD1 } from "../../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { visitorAppointmentDetailStatement, visitorAppointmentHistoryStatement } from "../../../../../lib/server/visitor-appointment-detail";

/**
 * Stable visitor-owned visit resource. The appointment endpoint remains
 * backwards compatible, while this boundary gives completion, receipt, and
 * future visit lifecycle features one canonical URL.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ visitId: string }> }) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const { visitId } = await params;
    if (!visitId || visitId.length > 128) throw new SecurityError("VISIT_NOT_FOUND", 404);
    const d1 = await getD1();
    const input = { appointmentId: visitId, visitorUserId: visitor.userId };
    const [visit, history] = await Promise.all([
      visitorAppointmentDetailStatement(d1, input).first<Record<string, string | number | null>>(),
      visitorAppointmentHistoryStatement(d1, input).all<Record<string, string | null>>(),
    ]);
    if (!visit) throw new SecurityError("VISIT_NOT_FOUND", 404);
    return securityResponse({ visit, statusHistory: history.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
