import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    await requireVisitorIdentity();
    const facilityId = new URL(request.url).searchParams.get("facilityId")?.trim() || "";
    if (!facilityId) return securityResponse({ appointmentTypes: [] }, 200, context.requestId);
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT at.code, at.display_name, at.description, at.duration_minutes, at.credit_cost, at.version
      FROM appointment_types at INNER JOIN facilities f ON f.id = at.facility_id INNER JOIN visit_policies vp ON vp.facility_id = at.facility_id
      WHERE at.facility_id = ? AND f.current_state = 'NORMAL_OPERATIONS' AND at.status = 'ACTIVE' ORDER BY at.display_name ASC`).bind(facilityId).all();
    return securityResponse({ facilityId, appointmentTypes: result.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
