import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requireOrganizationPermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value.trim());
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requireOrganizationPermission("organization.manage");
    const d1 = await getD1();
    const [assignments, roles, eligibleStaff] = await Promise.all([
      d1.prepare(`SELECT ora.user_id, ora.organization_id, ora.role_id, ora.status, ora.assigned_by, ora.version,
          ora.assigned_at, ora.created_at, ora.updated_at, u.email, u.display_name, r.name AS role_name
        FROM organization_role_assignments ora
        INNER JOIN users u ON u.id = ora.user_id
        INNER JOIN roles r ON r.id = ora.role_id
        WHERE ora.organization_id = ? ORDER BY u.display_name, r.name`).bind(authorization.organizationId).all(),
      d1.prepare(`SELECT r.id, r.name, r.description
        FROM roles r INNER JOIN role_permissions rp ON rp.role_id = r.id
        INNER JOIN permissions p ON p.id = rp.permission_id
        WHERE p.permission_key = 'organization.manage' ORDER BY r.name`).all(),
      d1.prepare(`SELECT DISTINCT u.id, u.email, u.display_name, u.status
        FROM organization_memberships om INNER JOIN users u ON u.id = om.user_id
        WHERE om.organization_id = ? AND om.status = 'ACTIVE' AND u.user_type = 'STAFF' AND u.status = 'ACTIVE'
        ORDER BY u.display_name`).bind(authorization.organizationId).all(),
    ]);
    return securityResponse({ organizationId: authorization.organizationId, assignments: assignments.results, roles: roles.results, eligibleStaff: eligibleStaff.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requireOrganizationPermission("organization.manage");
    const body = await request.json() as { userId?: unknown; roleId?: unknown; reason?: unknown };
    if (!validId(body.userId) || !validId(body.roleId)) throw new SecurityError("INVALID_ORGANIZATION_ROLE", 400);
    const userId = body.userId.trim();
    const roleId = body.roleId.trim();
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const [user, role, membership] = await Promise.all([
      d1.prepare("SELECT id, email, display_name FROM users WHERE id = ? AND user_type = 'STAFF' AND status = 'ACTIVE'").bind(userId).first<{ id: string; email: string | null; display_name: string }>(),
      d1.prepare(`SELECT r.id, r.name FROM roles r INNER JOIN role_permissions rp ON rp.role_id = r.id
        INNER JOIN permissions p ON p.id = rp.permission_id
        WHERE r.id = ? AND p.permission_key = 'organization.manage'`).bind(roleId).first<{ id: string; name: string }>(),
      d1.prepare("SELECT 1 AS active FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND status = 'ACTIVE' LIMIT 1").bind(authorization.organizationId, userId).first<{ active: number }>(),
    ]);
    if (!user) throw new SecurityError("STAFF_NOT_FOUND", 404);
    if (!role) throw new SecurityError("ORGANIZATION_ROLE_NOT_ALLOWED", 400);
    if (!membership) throw new SecurityError("STAFF_NOT_IN_ORGANIZATION", 409);
    const scope = `organization-role:${authorization.organizationId}:${userId}:${roleId}`;
    const requestHash = await hashIdempotencyPayload({ organizationId: authorization.organizationId, userId, roleId, reason });
    const claimed = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    await requireStepUp({ purpose: "organization_role_assign", userId: authorization.userId, targetId: userId, payload: { organizationId: authorization.organizationId, roleId, reason } });
    const existing = await d1.prepare("SELECT status, version FROM organization_role_assignments WHERE user_id = ? AND organization_id = ? AND role_id = ?").bind(userId, authorization.organizationId, roleId).first<{ status: string; version: number }>();
    if (existing?.status === "ACTIVE") throw new SecurityError("ORGANIZATION_ROLE_ALREADY_ACTIVE", 409);
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { assignment: { userId, organizationId: authorization.organizationId, roleId, roleName: role.name, status: "ACTIVE", version: (existing?.version || 0) + 1 }, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM organization_role_assignments WHERE user_id = ? AND organization_id = ? AND role_id = ? AND status = 'ACTIVE' AND version = ?)", values: [userId, authorization.organizationId, roleId, responseBody.assignment.version] };
    const results = await d1.batch([
      d1.prepare(`INSERT INTO organization_role_assignments (user_id, organization_id, role_id, status, assigned_by, version, assigned_at, created_at, updated_at)
        VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, organization_id, role_id) DO UPDATE SET status = 'ACTIVE', assigned_by = excluded.assigned_by, version = excluded.version, assigned_at = excluded.assigned_at, updated_at = excluded.updated_at`)
        .bind(userId, authorization.organizationId, roleId, authorization.userId, responseBody.assignment.version, now, now, now),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Organization Administrator", facilityId: authorization.facilityId, actionType: "ORGANIZATION_ROLE_ASSIGNED", entityType: "organization_role_assignment", entityId: `${authorization.organizationId}:${userId}:${roleId}`, reason, oldValues: existing || null, newValues: responseBody.assignment, requestId: context.requestId, correlationId, eventType: "ORGANIZATION_ROLE_ASSIGNED", payload: { organizationId: authorization.organizationId, userId, roleId, roleName: role.name } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard }),
    ]);
    if (!results[0]?.meta.changes || !results.slice(1).every((result) => Boolean(result?.meta.changes))) throw new SecurityError("ORGANIZATION_ROLE_ASSIGN_FAILED", 409);
    idempotency = null;
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PATCH(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const body = await request.json() as { userId?: unknown; roleId?: unknown; expectedVersion?: unknown; reason?: unknown };
    if (!validId(body.userId) || !validId(body.roleId) || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new SecurityError("INVALID_ORGANIZATION_ROLE_UPDATE", 400);
    const userId = body.userId.trim();
    const roleId = body.roleId.trim();
    const expectedVersion = Number(body.expectedVersion);
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const authorization = await requireOrganizationPermission("organization.manage");
    d1 = await getD1();
    const current = await d1.prepare(`SELECT user_id, organization_id, role_id, status, version FROM organization_role_assignments
      WHERE user_id = ? AND organization_id = ? AND role_id = ?`).bind(userId, authorization.organizationId, roleId).first<{ user_id: string; organization_id: string; role_id: string; status: string; version: number }>();
    if (!current) throw new SecurityError("ORGANIZATION_ROLE_NOT_FOUND", 404);
    if (current.version !== expectedVersion) throw new SecurityError("STALE_ORGANIZATION_ROLE", 409);
    const scope = `organization-role-revoke:${authorization.organizationId}:${userId}:${roleId}`;
    const requestHash = await hashIdempotencyPayload({ organizationId: authorization.organizationId, userId, roleId, expectedVersion, reason });
    const claimed = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    await requireStepUp({ purpose: "organization_role_revoke", userId: authorization.userId, targetId: userId, payload: { organizationId: authorization.organizationId, roleId, expectedVersion, reason } });
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { userId, organizationId: authorization.organizationId, roleId, status: "REVOKED", version: expectedVersion + 1, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM organization_role_assignments WHERE user_id = ? AND organization_id = ? AND role_id = ? AND status = 'REVOKED' AND version = ?)", values: [userId, authorization.organizationId, roleId, expectedVersion + 1] };
    const results = await d1.batch([
      d1.prepare("UPDATE organization_role_assignments SET status = 'REVOKED', version = version + 1, updated_at = ? WHERE user_id = ? AND organization_id = ? AND role_id = ? AND status = 'ACTIVE' AND version = ?").bind(now, userId, authorization.organizationId, roleId, expectedVersion),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Organization Administrator", facilityId: authorization.facilityId, actionType: "ORGANIZATION_ROLE_REVOKED", entityType: "organization_role_assignment", entityId: `${authorization.organizationId}:${userId}:${roleId}`, reason, oldValues: current, newValues: responseBody, requestId: context.requestId, correlationId, eventType: "ORGANIZATION_ROLE_REVOKED", payload: { organizationId: authorization.organizationId, userId, roleId } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody, guard }),
    ]);
    if (!results[0]?.meta.changes || !results.slice(1).every((result) => Boolean(result?.meta.changes))) throw new SecurityError("ORGANIZATION_ROLE_REVOKE_FAILED", 409);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
