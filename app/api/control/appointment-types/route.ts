import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT id, code, display_name, description, duration_minutes, credit_cost, status, version, updated_at
      FROM appointment_types WHERE facility_id = ? ORDER BY display_name ASC`).bind(authorization.facilityId).all();
    return securityResponse({ facilityId: authorization.facilityId, appointmentTypes: result.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
