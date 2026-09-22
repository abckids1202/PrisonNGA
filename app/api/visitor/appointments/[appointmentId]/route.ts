import { getD1 } from "../../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { visitorAppointmentDetailStatement, visitorAppointmentHistoryStatement } from "../../../../../lib/server/visitor-appointment-detail";

export async function GET(_request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const { appointmentId } = await params;
    if (!appointmentId || appointmentId.length > 128) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    const d1 = await getD1();
    const input = { appointmentId, visitorUserId: visitor.userId };
    const [appointment, history] = await Promise.all([
      visitorAppointmentDetailStatement(d1, input).first<Record<string, string | number | null>>(),
      visitorAppointmentHistoryStatement(d1, input).all<Record<string, string | null>>(),
    ]);
    if (!appointment) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    return securityResponse({ appointment, statusHistory: history.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
