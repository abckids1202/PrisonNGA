import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requireOrganizationPermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const timezonePattern = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/;

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requireOrganizationPermission("organization.manage");
    const d1 = await getD1();
    const organization = await d1.prepare("SELECT id, name, slug, address, contact_email, contact_phone, status, version FROM organizations WHERE id = ?").bind(authorization.organizationId).first();
    if (!organization) throw new SecurityError("ORGANIZATION_NOT_FOUND", 404);
    const facilities = await d1.prepare(`SELECT id, name, timezone, address, contact_email, contact_phone, current_state, version, created_at, updated_at FROM facilities WHERE organization_id = ? ORDER BY name ASC`).bind(organization.id).all();
    return securityResponse({ organization, facilities: facilities.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requireOrganizationPermission("organization.manage");
    const body = await request.json() as { name?: unknown; timezone?: unknown; reason?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
    const reason = assertReason(body.reason);
    if (name.length < 2 || !timezonePattern.test(timezone)) throw new SecurityError("INVALID_FACILITY_DETAILS", 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const organization = await d1.prepare("SELECT id FROM organizations WHERE id = ? AND status = 'ACTIVE'").bind(authorization.organizationId).first<{ id: string }>();
    if (!organization) throw new SecurityError("ORGANIZATION_NOT_FOUND", 404);
    await requireStepUp({ purpose: "facility_create", userId: authorization.userId, targetId: organization.id, payload: { name, timezone, reason } });
    const scope = `organization-facility-create:${organization.id}:${authorization.userId}`;
    const requestHash = await hashIdempotencyPayload({ name, timezone, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    const facilityId = crypto.randomUUID();
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const role = await d1.prepare(`SELECT ur.role_id, r.name FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND ur.facility_id = ? ORDER BY CASE WHEN r.name = 'Supervisor' THEN 0 ELSE 1 END LIMIT 1`).bind(authorization.userId, authorization.facilityId).first<{ role_id: string; name: string }>();
    if (!role) throw new SecurityError("STAFF_ROLE_NOT_FOUND", 409);
    const responseBody = { facility: { id: facilityId, organizationId: organization.id, name, timezone, address: null, contactEmail: null, contactPhone: null, currentState: "NORMAL_OPERATIONS", version: 1 }, correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM facilities WHERE id = ? AND organization_id = ? AND version = 1)", values: [facilityId, organization.id] };
    const results = await d1.batch([
      d1.prepare(`INSERT INTO facilities (id, organization_id, name, timezone, current_state, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'NORMAL_OPERATIONS', 1, ?, ?)`).bind(facilityId, organization.id, name, timezone, now, now),
      d1.prepare(`INSERT INTO visit_policies (id, facility_id, min_duration_minutes, max_duration_minutes, min_advance_minutes, max_advance_days, daily_start_time, daily_end_time, credit_currency, recording_policy, version, created_at, updated_at) VALUES (?, ?, 15, 30, 60, 30, '08:00', '17:00', 'IDR', 'OFF', 1, ?, ?)`).bind(crypto.randomUUID(), facilityId, now, now),
      d1.prepare(`INSERT INTO staff_facility_assignments (user_id, facility_id, employee_reference, job_title, department, status, assigned_by, version, created_at, updated_at) SELECT ?, ?, employee_reference, job_title, department, 'ACTIVE', ?, 1, ?, ? FROM staff_profiles WHERE user_id = ? AND facility_id = ?`).bind(authorization.userId, facilityId, authorization.userId, now, now, authorization.userId, authorization.facilityId),
      d1.prepare(`INSERT INTO user_roles (user_id, role_id, facility_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?)`).bind(authorization.userId, role.role_id, facilityId, authorization.userId, now),
      d1.prepare(`INSERT INTO organization_memberships (id, organization_id, user_id, facility_id, role, status, assigned_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, 1, ?, ?)`).bind(crypto.randomUUID(), organization.id, authorization.userId, facilityId, role.name, authorization.userId, now, now),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId, actionType: "FACILITY_CREATED", entityType: "facility", entityId: facilityId, reason, newValues: responseBody.facility, requestId: context.requestId, correlationId, eventType: "FACILITY_CREATED", payload: { facilityId, organizationId: organization.id } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard }),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes || !results[2]?.meta.changes || !results[3]?.meta.changes || !results[4]?.meta.changes || !results.slice(5).every((result) => Boolean(result?.meta.changes))) throw new SecurityError("FACILITY_CREATE_FAILED", 409);
    idempotency = null;
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
