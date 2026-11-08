import { getD1 } from "../../../../db/runtime";
import { getRequestContext, getRuntimeValue, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const contextCookie = "securevisit_facility_context";

function cookieValue(facilityId: string, secure: boolean): string {
  return `${contextCookie}=${encodeURIComponent(facilityId)}; Path=/; Max-Age=28800; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const facilities = await d1.prepare(`SELECT f.id, f.name, f.timezone, f.current_state, f.version
      FROM facilities f WHERE EXISTS (SELECT 1 FROM staff_facility_assignments sfa WHERE sfa.user_id = ? AND sfa.facility_id = f.id AND sfa.status = 'ACTIVE')
      OR EXISTS (SELECT 1 FROM staff_profiles sp WHERE sp.user_id = ? AND sp.facility_id = f.id) ORDER BY f.name`).bind(authorization.userId, authorization.userId).all();
    return securityResponse({ selectedFacilityId: authorization.facilityId, facilities: facilities.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function PUT(request: Request) {
  const context = await getRequestContext();
  try {
    const body = await request.json() as { facilityId?: unknown };
    const facilityId = typeof body.facilityId === "string" ? body.facilityId.trim() : "";
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(facilityId)) throw new SecurityError("FACILITY_ID_REQUIRED", 400);
    const authorization = await requirePermission("facility.read", facilityId);
    const response = securityResponse({ selectedFacilityId: authorization.facilityId }, 200, context.requestId);
    const secure = (await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) !== "development";
    response.headers.append("Set-Cookie", cookieValue(authorization.facilityId, secure));
    return response;
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
