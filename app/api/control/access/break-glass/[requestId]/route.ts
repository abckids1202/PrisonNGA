import { getD1 } from "../../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";

const actions = new Set(["APPROVE", "DENY", "REVOKE"]);

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("access.break_glass.approve");
    const { requestId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new SecurityError("INVALID_BREAK_GLASS_REQUEST_ID", 400);
    const body = await request.json() as { action?: unknown; reason?: unknown; expectedVersion?: unknown };
    const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
    const reason = assertReason(body.reason);
    if (!actions.has(action)) throw new SecurityError("INVALID_BREAK_GLASS_ACTION", 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const current = await d1.prepare(`SELECT id, requested_by, target_type, target_id, reason, duration_minutes, status, version
      FROM break_glass_requests WHERE id = ? AND facility_id = ?`).bind(requestId, authorization.facilityId).first<{ id: string; requested_by: string; target_type: string; target_id: string; reason: string; duration_minutes: number; status: string; version: number }>();
    if (!current) throw new SecurityError("BREAK_GLASS_REQUEST_NOT_FOUND", 404);
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) throw new SecurityError("STALE_BREAK_GLASS_REQUEST", 409);
    const expectedStatus = action === "APPROVE" || action === "DENY" ? "PENDING" : "APPROVED";
    if (current.status !== expectedStatus) throw new SecurityError("BREAK_GLASS_INVALID_TRANSITION", 409);
    const payload = { requestId, action, reason, expectedVersion: body.expectedVersion ?? current.version };
    const scope = `break-glass-decision:${authorization.facilityId}:${requestId}`;
    const requestHash = await hashIdempotencyPayload(payload);
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    await requireStepUp({ purpose: "break_glass_approve", userId: authorization.userId, targetId: requestId, payload });
    const nextStatus = action === "APPROVE" ? "APPROVED" : action === "DENY" ? "DENIED" : "REVOKED";
    const now = new Date().toISOString();
    const expiresAt = action === "APPROVE" ? new Date(Date.now() + current.duration_minutes * 60_000).toISOString() : null;
    const correlationId = crypto.randomUUID();
    const responseBody = { requestId, status: nextStatus, expiresAt, correlationId };
    const updated = await d1.batch([
      d1.prepare(`UPDATE break_glass_requests SET status = ?, approved_by = CASE WHEN ? = 'APPROVE' THEN ? ELSE approved_by END, approved_at = CASE WHEN ? = 'APPROVE' THEN ? ELSE approved_at END, expires_at = CASE WHEN ? = 'APPROVE' THEN ? ELSE expires_at END, revoked_at = CASE WHEN ? = 'REVOKE' THEN ? ELSE revoked_at END, decision_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND status = ? AND version = ?`)
        .bind(nextStatus, action, authorization.userId, action, now, action, expiresAt, action, now, reason, now, requestId, authorization.facilityId, expectedStatus, current.version),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: `BREAK_GLASS_${action}`, entityType: "break_glass_request", entityId: requestId, reason, oldValues: { status: current.status, version: current.version }, newValues: { status: nextStatus, expiresAt, version: current.version + 1 }, requestId: context.requestId, correlationId, eventType: `BREAK_GLASS_${action}`, payload: { requestId, targetType: current.target_type, targetId: current.target_id, status: nextStatus } }, { sql: "EXISTS (SELECT 1 FROM break_glass_requests WHERE id = ? AND status = ? AND version = ?)", values: [requestId, nextStatus, current.version + 1] }),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM break_glass_requests WHERE id = ? AND status = ? AND version = ?)", values: [requestId, nextStatus, current.version + 1] } }),
    ]);
    if (!updated[0]?.meta.changes || !updated.at(-1)?.meta.changes) throw new SecurityError("BREAK_GLASS_DECISION_NOT_PERSISTED", 409);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
