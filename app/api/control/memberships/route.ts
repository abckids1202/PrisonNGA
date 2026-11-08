import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

function validId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value.trim()); }

async function organizationForFacility(d1: D1Database, facilityId: string): Promise<string> {
  const row = await d1.prepare("SELECT organization_id FROM facilities WHERE id = ?").bind(facilityId).first<{ organization_id: string | null }>();
  if (!row?.organization_id) throw new SecurityError("FACILITY_NOT_FOUND", 404);
  return row.organization_id;
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("organization.manage");
    const d1 = await getD1();
    const organizationId = await organizationForFacility(d1, authorization.facilityId);
    const memberships = await d1.prepare(`SELECT om.id, om.organization_id, om.user_id, om.facility_id, om.role, om.status, om.version,
      om.assigned_by, om.created_at, om.updated_at, u.email, u.display_name, f.name AS facility_name
      FROM organization_memberships om INNER JOIN users u ON u.id = om.user_id
      LEFT JOIN facilities f ON f.id = om.facility_id
      WHERE om.organization_id = ? ORDER BY COALESCE(f.name, ''), u.display_name`).bind(organizationId).all();
    return securityResponse({ organizationId, memberships: memberships.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const body = await request.json() as { userId?: unknown; facilityId?: unknown; roleId?: unknown; employeeReference?: unknown; jobTitle?: unknown; department?: unknown; reason?: unknown };
    if (!validId(body.userId) || !validId(body.facilityId) || !validId(body.roleId)) throw new SecurityError("INVALID_MEMBERSHIP_DETAILS", 400);
    const facilityId = body.facilityId.trim();
    const authorization = await requirePermission("organization.manage", facilityId);
    const employeeReference = typeof body.employeeReference === "string" ? body.employeeReference.trim().slice(0, 80) : "";
    const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim().slice(0, 120) : "";
    const department = typeof body.department === "string" ? body.department.trim().slice(0, 120) : null;
    const reason = assertReason(body.reason);
    if (!employeeReference || !jobTitle) throw new SecurityError("INVALID_MEMBERSHIP_DETAILS", 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const organizationId = await organizationForFacility(d1, facilityId);
    const actorOrganizationId = await organizationForFacility(d1, authorization.facilityId);
    if (organizationId !== actorOrganizationId) throw new SecurityError("ORGANIZATION_SCOPE_DENIED", 403);
    const user = await d1.prepare("SELECT id, email, display_name FROM users WHERE id = ? AND user_type = 'STAFF' AND status = 'ACTIVE'").bind(body.userId.trim()).first<{ id: string; email: string; display_name: string }>();
    if (!user) throw new SecurityError("STAFF_NOT_FOUND", 404);
    const role = await d1.prepare("SELECT id, name FROM roles WHERE id = ?").bind(body.roleId.trim()).first<{ id: string; name: string }>();
    if (!role) throw new SecurityError("STAFF_ROLE_NOT_FOUND", 404);
    const scope = `organization-membership-create:${facilityId}:${body.userId.trim()}`;
    const requestHash = await hashIdempotencyPayload({ userId: body.userId.trim(), facilityId, roleId: role.id, employeeReference, jobTitle, department, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    await requireStepUp({ purpose: "staff_membership_create", userId: authorization.userId, targetId: body.userId.trim(), payload: { facilityId, roleId: role.id, employeeReference, jobTitle, department, reason } });
    const existing = await d1.prepare("SELECT id FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND facility_id = ? AND status = 'ACTIVE'").bind(organizationId, user.id, facilityId).first();
    if (existing) throw new SecurityError("MEMBERSHIP_ALREADY_ACTIVE", 409);
    const membershipId = crypto.randomUUID();
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { membership: { id: membershipId, organizationId, userId: user.id, facilityId, role: role.name, status: "ACTIVE", version: 1 }, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM organization_memberships WHERE id = ? AND status = 'ACTIVE')", values: [membershipId] };
    const results = await d1.batch([
      d1.prepare(`INSERT INTO staff_facility_assignments (user_id, facility_id, employee_reference, job_title, department, status, assigned_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, 1, ?, ?)
        ON CONFLICT(user_id, facility_id) DO UPDATE SET employee_reference = excluded.employee_reference, job_title = excluded.job_title, department = excluded.department, status = 'ACTIVE', assigned_by = excluded.assigned_by, version = staff_facility_assignments.version + 1, updated_at = excluded.updated_at`).bind(user.id, facilityId, employeeReference, jobTitle, department, authorization.userId, now, now),
      d1.prepare("INSERT INTO user_roles (user_id, role_id, facility_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, role_id, facility_id) DO NOTHING").bind(user.id, role.id, facilityId, authorization.userId, now),
      d1.prepare("INSERT INTO organization_memberships (id, organization_id, user_id, facility_id, role, status, assigned_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, 1, ?, ?)").bind(membershipId, organizationId, user.id, facilityId, role.name, authorization.userId, now, now),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId, actionType: "STAFF_MEMBERSHIP_CREATED", entityType: "organization_membership", entityId: membershipId, reason, newValues: responseBody.membership, requestId: context.requestId, correlationId, eventType: "STAFF_MEMBERSHIP_CREATED", payload: { membershipId, userId: user.id, facilityId, role: role.name } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard }),
    ]);
    if (!results[0]?.meta.changes || !results[1] || !results[2]?.meta.changes || !results.slice(3).every((result) => Boolean(result?.meta.changes))) throw new SecurityError("MEMBERSHIP_CREATE_FAILED", 409);
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
    const body = await request.json() as { membershipId?: unknown; expectedVersion?: unknown; reason?: unknown };
    if (!validId(body.membershipId) || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new SecurityError("INVALID_MEMBERSHIP_UPDATE", 400);
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const current = await d1.prepare(`SELECT om.id, om.organization_id, om.user_id, om.facility_id, om.role, om.status, om.version
      FROM organization_memberships om WHERE om.id = ?`).bind(body.membershipId.trim()).first<{ id: string; organization_id: string; user_id: string; facility_id: string; role: string; status: string; version: number }>();
    if (!current?.facility_id) throw new SecurityError("MEMBERSHIP_NOT_FOUND", 404);
    const authorization = await requirePermission("organization.manage", current.facility_id);
    const actorOrganizationId = await organizationForFacility(d1, authorization.facilityId);
    if (actorOrganizationId !== current.organization_id) throw new SecurityError("ORGANIZATION_SCOPE_DENIED", 403);
    const scope = `organization-membership-revoke:${current.id}`;
    const requestHash = await hashIdempotencyPayload({ membershipId: current.id, expectedVersion: body.expectedVersion, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    if (current.version !== body.expectedVersion) throw new SecurityError("STALE_MEMBERSHIP", 409);
    await requireStepUp({ purpose: "staff_membership_revoke", userId: authorization.userId, targetId: current.user_id, payload: { membershipId: current.id, expectedVersion: body.expectedVersion, reason } });
    if (current.status === "REVOKED") {
      const responseBody = { membershipId: current.id, status: "REVOKED", version: current.version, idempotent: true };
      const completed = await d1.prepare("UPDATE idempotency_records SET status = 'COMPLETED', processing_started_at = NULL, response_status = 200, response_body = ?, completed_at = ? WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'").bind(JSON.stringify(responseBody), new Date().toISOString(), idempotency.claimId, idempotency.scope, idempotency.key).run();
      if (!completed.meta.changes) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
      idempotency = null;
      return securityResponse(responseBody, 200, context.requestId);
    }
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { membershipId: current.id, status: "REVOKED", version: current.version + 1, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM organization_memberships WHERE id = ? AND status = 'REVOKED' AND version = ?)", values: [current.id, current.version + 1] };
    const results = await d1.batch([
      d1.prepare("UPDATE organization_memberships SET status = 'REVOKED', version = version + 1, updated_at = ? WHERE id = ? AND status = 'ACTIVE' AND version = ?").bind(now, current.id, current.version),
      d1.prepare("UPDATE staff_facility_assignments SET status = 'REVOKED', version = version + 1, updated_at = ? WHERE user_id = ? AND facility_id = ? AND status = 'ACTIVE'").bind(now, current.user_id, current.facility_id),
      d1.prepare("DELETE FROM user_roles WHERE user_id = ? AND facility_id = ?").bind(current.user_id, current.facility_id),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: current.facility_id, actionType: "STAFF_MEMBERSHIP_REVOKED", entityType: "organization_membership", entityId: current.id, reason, oldValues: { status: current.status, role: current.role }, newValues: responseBody, requestId: context.requestId, correlationId, eventType: "STAFF_MEMBERSHIP_REVOKED", payload: { membershipId: current.id, userId: current.user_id, facilityId: current.facility_id } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody, guard }),
    ]);
    if (!results[0]?.meta.changes || !results[1] || !results.slice(3).every((result) => Boolean(result?.meta.changes))) throw new SecurityError("MEMBERSHIP_REVOKE_FAILED", 409);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
