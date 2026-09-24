import { getD1 } from "../../../../db/runtime";
import { financeSummaryStatement } from "../../../../lib/server/finance-directory";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const auditAuthorization = await requirePermission("audit.read");
    await requirePermission("finance.read", auditAuthorization.facilityId);
    const d1 = await getD1();
    const [facility, audit, appointments, incidents, finance] = await Promise.all([
      d1.prepare("SELECT id, name, timezone, current_state, version FROM facilities WHERE id = ?").bind(auditAuthorization.facilityId).first(),
      d1.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE facility_id = ?").bind(auditAuthorization.facilityId).first<{ count: number }>(),
      d1.prepare("SELECT status, COUNT(*) AS count FROM appointments WHERE facility_id = ? GROUP BY status ORDER BY status").bind(auditAuthorization.facilityId).all<{ status: string; count: number }>(),
      d1.prepare("SELECT status, severity, COUNT(*) AS count FROM incidents WHERE facility_id = ? GROUP BY status, severity ORDER BY status, severity").bind(auditAuthorization.facilityId).all<{ status: string; severity: string; count: number }>(),
      financeSummaryStatement(d1, auditAuthorization.facilityId).first(),
    ]);
    return securityResponse({
      facilityId: auditAuthorization.facilityId,
      generatedAt: new Date().toISOString(),
      facility,
      audit: { eventCount: Number(audit?.count || 0) },
      appointments: appointments.results,
      incidents: incidents.results,
      finance: finance || {},
    }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
