import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const organization = await d1.prepare(`SELECT o.id, o.name, o.slug, o.status, o.version, o.created_at, o.updated_at
      FROM organizations o INNER JOIN facilities f ON f.organization_id = o.id
      WHERE f.id = ?`).bind(authorization.facilityId).first();
    if (!organization) return securityResponse({ organization: null, facilities: [] }, 200, context.requestId);
    const facilities = await d1.prepare(`SELECT f.id, f.name, f.timezone, f.current_state, f.version, f.created_at, f.updated_at
      FROM facilities f
      WHERE f.organization_id = ? AND EXISTS (
        SELECT 1 FROM organization_memberships om
        WHERE om.organization_id = f.organization_id AND om.facility_id = f.id
          AND om.user_id = ? AND om.status = 'ACTIVE'
      ) ORDER BY f.name ASC`).bind(organization.id, authorization.userId).all();
    return securityResponse({ organization, facilities: facilities.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
