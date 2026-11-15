import { getD1 } from "../../../../../db/runtime";
import { getRequestContext, requireOrganizationPermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { PATCH as updateOrganization } from "../route";

type OrganizationRouteContext = { params: Promise<{ organizationId: string }> };

async function assertOrganizationScope(organizationId: string): Promise<Awaited<ReturnType<typeof requireOrganizationPermission>>> {
  if (!organizationId || organizationId.length > 128) throw new SecurityError("ORGANIZATION_SCOPE_DENIED", 403);
  const authorization = await requireOrganizationPermission("organization.manage");
  if (authorization.organizationId !== organizationId) throw new SecurityError("ORGANIZATION_SCOPE_DENIED", 403);
  return authorization;
}

export async function GET(_request: Request, { params }: OrganizationRouteContext) {
  const context = await getRequestContext();
  try {
    const { organizationId } = await params;
    await assertOrganizationScope(organizationId);
    const d1 = await getD1();
    const organization = await d1.prepare(`SELECT o.id, o.name, o.slug, o.address, o.contact_email, o.contact_phone, o.status, o.version, o.created_at, o.updated_at
      FROM organizations o WHERE o.id = ? AND o.status = 'ACTIVE'`).bind(organizationId).first();
    if (!organization) throw new SecurityError("ORGANIZATION_NOT_FOUND", 404);
    const facilities = await d1.prepare(`SELECT f.id, f.name, f.timezone, f.current_state, f.version, f.created_at, f.updated_at
      FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
      WHERE f.organization_id = ? ORDER BY f.name ASC`).bind(organizationId).all();
    return securityResponse({ organization, facilities: facilities.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PATCH(request: Request, { params }: OrganizationRouteContext) {
  const context = await getRequestContext();
  try {
    const { organizationId } = await params;
    await assertOrganizationScope(organizationId);
    // The canonical handler owns validation, optimistic concurrency, step-up,
    // idempotency, audit, and outbox behavior. The path guard above ensures
    // the resource URL cannot be used to update another organization.
    return await updateOrganization(request);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
