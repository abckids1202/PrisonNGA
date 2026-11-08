import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireOrganizationPermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requireOrganizationPermission("organization.manage");
    const d1 = await getD1();
    const organization = await d1.prepare(`SELECT o.id, o.name, o.slug, o.status, o.version, o.created_at, o.updated_at
      FROM organizations o WHERE o.id = ?`).bind(authorization.organizationId).first();
    if (!organization) return securityResponse({ organization: null, facilities: [] }, 200, context.requestId);
    const facilities = await d1.prepare(`SELECT f.id, f.name, f.timezone, f.current_state, f.version, f.created_at, f.updated_at
      FROM facilities f
      WHERE f.organization_id = ? ORDER BY f.name ASC`).bind(organization.id).all();
    return securityResponse({ organization, facilities: facilities.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
