import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

const targetTypes = new Set(["evidence_document", "visit_session", "appointment"]);

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("access.break_glass.request");
    const d1 = await getD1();
    const rows = await d1.prepare(`SELECT id, requested_by, approved_by, target_type, target_id, reason, decision_reason, status, expires_at, approved_at, revoked_at, version, correlation_id, created_at, updated_at
      FROM break_glass_requests WHERE facility_id = ? ORDER BY created_at DESC LIMIT 100`).bind(authorization.facilityId).all();
    return securityResponse({ requests: rows.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("access.break_glass.request");
    const body = await request.json() as { targetType?: unknown; targetId?: unknown; reason?: unknown; durationMinutes?: unknown };
    const targetType = typeof body.targetType === "string" ? body.targetType.trim() : "";
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    const reason = assertReason(body.reason);
    const durationMinutes = Number(body.durationMinutes ?? 30);
    if (!targetTypes.has(targetType) || !/^[A-Za-z0-9._:-]{1,160}$/.test(targetId)) throw new SecurityError("INVALID_BREAK_GLASS_TARGET", 400);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 60) throw new SecurityError("INVALID_BREAK_GLASS_DURATION", 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const payload = { targetType, targetId, reason, durationMinutes };
    d1 = await getD1();
    const target = targetType === "evidence_document"
      ? await d1.prepare("SELECT id FROM evidence_documents WHERE id = ? AND facility_id = ? AND status = 'AVAILABLE'").bind(targetId, authorization.facilityId).first()
      : targetType === "visit_session"
        ? await d1.prepare("SELECT id FROM visit_sessions WHERE id = ? AND facility_id = ?").bind(targetId, authorization.facilityId).first()
        : await d1.prepare("SELECT id FROM appointments WHERE id = ? AND facility_id = ?").bind(targetId, authorization.facilityId).first();
    if (!target) throw new SecurityError("BREAK_GLASS_TARGET_NOT_FOUND", 404);
    const scope = `break-glass-request:${authorization.facilityId}:${authorization.userId}:${targetType}:${targetId}`;
    const requestHash = await hashIdempotencyPayload(payload);
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    await requireStepUp({ purpose: "break_glass_request", userId: authorization.userId, targetId: `${authorization.facilityId}:${targetType}:${targetId}`, payload });
    const requestId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const responseBody = { requestId, targetType, targetId, status: "PENDING", correlationId };
    const inserted = await d1.batch([
      d1.prepare(`INSERT INTO break_glass_requests (id, facility_id, requested_by, target_type, target_id, reason, duration_minutes, status, version, correlation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 1, ?, ?, ?)`)
        .bind(requestId, authorization.facilityId, authorization.userId, targetType, targetId, reason, durationMinutes, correlationId, now, now),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Staff", facilityId: authorization.facilityId, actionType: "BREAK_GLASS_REQUESTED", entityType: "break_glass_request", entityId: requestId, reason, newValues: { targetType, targetId, status: "PENDING", durationMinutes }, requestId: context.requestId, correlationId, eventType: "BREAK_GLASS_REQUESTED", payload: { requestId, targetType, targetId } }),
      completeIdempotencyStatement(d1, { ...idempotency, status: 202, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM break_glass_requests WHERE id = ? AND status = 'PENDING')", values: [requestId] } }),
    ]);
    if (!inserted[0]?.meta.changes || !inserted.at(-1)?.meta.changes) throw new SecurityError("BREAK_GLASS_REQUEST_NOT_PERSISTED", 409);
    idempotency = null;
    return securityResponse(responseBody, 202, context.requestId);
  } catch (error) {
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
