import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    await requireVisitorIdentity();
    const facilityId = new URL(request.url).searchParams.get("facilityId")?.trim() || "";
    if (!facilityId) return securityResponse({ appointmentTypes: [] }, 200, context.requestId);
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT code, display_name, description, duration_minutes, credit_cost, version
      FROM appointment_types WHERE facility_id = ? AND status = 'ACTIVE' ORDER BY display_name ASC`).bind(facilityId).all();
    return securityResponse({ facilityId, appointmentTypes: result.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
