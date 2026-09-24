import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const statuses = ["ACTIVE", "SUSPENDED", "DISABLED"] as const;

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT u.id, u.email, u.display_name, u.external_id, u.status, u.last_login_at, u.version, sp.employee_reference, sp.job_title, sp.department, GROUP_CONCAT(r.name, ', ') AS roles
      FROM users u INNER JOIN staff_profiles sp ON sp.user_id = u.id LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.facility_id = sp.facility_id LEFT JOIN roles r ON r.id = ur.role_id
      WHERE sp.facility_id = ? AND u.user_type = 'STAFF' GROUP BY u.id ORDER BY u.display_name`).bind(authorization.facilityId).all();
    return securityResponse({ staff: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("staff.manage");
    const body = await request.json() as { email?: unknown; displayName?: unknown; employeeReference?: unknown; jobTitle?: unknown; department?: unknown; roleId?: unknown; reason?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 160) : "";
    const employeeReference = typeof body.employeeReference === "string" ? body.employeeReference.trim().slice(0, 80) : "";
    const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim().slice(0, 120) : "";
    const department = typeof body.department === "string" ? body.department.trim().slice(0, 120) : null;
    const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName || !employeeReference || !jobTitle || !roleId) throw new SecurityError("INVALID_STAFF_PROVISIONING", 400);
    d1 = await getD1();
    const idempotencyScope = `staff-provision:${authorization.facilityId}:${authorization.userId}`;
    const requestHash = await hashIdempotencyPayload({ email, displayName, employeeReference, jobTitle, department, roleId, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope: idempotencyScope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope: idempotencyScope, key: idempotencyKey };
    const role = await d1.prepare("SELECT id, name FROM roles WHERE id = ?").bind(roleId).first<{ id: string; name: string }>();
    if (!role) throw new SecurityError("STAFF_ROLE_NOT_FOUND", 404);
    const existing = await d1.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").bind(email).first<{ id: string }>();
    if (existing) throw new SecurityError("STAFF_EMAIL_ALREADY_REGISTERED", 409);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { userId, email, displayName, status: "ACTIVE", role: role.name, correlationId };
    const auditGuard = { sql: "EXISTS (SELECT 1 FROM users WHERE id = ? AND user_type = 'STAFF' AND status = 'ACTIVE')", values: [userId] };
    const results = await d1.batch([
      d1.prepare("INSERT INTO users (id, external_id, email, display_name, user_type, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'STAFF', 'ACTIVE', 1, ?, ?)").bind(userId, `pending:staff:${userId}`, email, displayName, now, now),
      d1.prepare("INSERT INTO staff_profiles (user_id, facility_id, employee_reference, job_title, department, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(userId, authorization.facilityId, employeeReference, jobTitle, department, now, now),
      d1.prepare("INSERT INTO user_roles (user_id, role_id, facility_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?)").bind(userId, role.id, authorization.facilityId, authorization.userId, now),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: "STAFF_PROVISIONED", entityType: "staff_user", entityId: userId, reason, newValues: { email, displayName, employeeReference, jobTitle, department, role: role.name, status: "ACTIVE" }, requestId: context.requestId, correlationId, eventType: "STAFF_PROVISIONED", payload: { userId, email } }, auditGuard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard: auditGuard }),
    ]);
    if (!results[0]?.meta.changes || !results[3]?.meta.changes || !results[results.length - 1]?.meta.changes) throw new SecurityError("STAFF_PROVISIONING_FAILED", 409);
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original provisioning error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PATCH(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("staff.manage");
    const body = await request.json() as { userId?: unknown; status?: unknown; expectedVersion?: unknown; reason?: unknown };
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const status = typeof body.status === "string" && statuses.includes(body.status as typeof statuses[number]) ? body.status : "";
    const reason = assertReason(body.reason);
    if (!userId || !status) throw new SecurityError("INVALID_STAFF_STATUS", 400);
    const d1 = await getD1();
    const current = await d1.prepare("SELECT u.id, u.status, u.version FROM users u INNER JOIN staff_profiles sp ON sp.user_id = u.id WHERE u.id = ? AND u.user_type = 'STAFF' AND sp.facility_id = ?").bind(userId, authorization.facilityId).first<{ id: string; status: string; version: number }>();
    if (!current) throw new SecurityError("STAFF_NOT_FOUND", 404);
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) throw new SecurityError("STALE_STAFF_RECORD", 409);
    if (status === "DISABLED") await requireStepUp({ purpose: "staff_disable", userId: authorization.userId, targetId: userId, payload: { status, expectedVersion: body.expectedVersion ?? current.version, reason } });
    if (current.status === status) return securityResponse({ userId, status, version: current.version, idempotent: true }, 200, context.requestId);
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const auditGuard = { sql: "EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND status = ?)", values: [userId, current.version + 1, status] };
    const results = await d1.batch([
      d1.prepare("UPDATE users SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(status, now, userId, current.version),
      d1.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND ? <> 'ACTIVE' AND EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND status = ?)").bind(now, userId, status, userId, current.version + 1, status),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: `STAFF_${status}`, entityType: "staff_user", entityId: userId, reason, oldValues: { status: current.status }, newValues: { status, sessionsRevoked: status === "ACTIVE" ? 0 : "all active sessions" }, requestId: context.requestId, correlationId, eventType: `STAFF_${status}`, payload: { userId, status } }, auditGuard),
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("STALE_STAFF_RECORD", 409);
    return securityResponse({ userId, status, version: current.version + 1, sessionsRevoked: status === "ACTIVE" ? 0 : results[1]?.meta.changes || 0, correlationId }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
