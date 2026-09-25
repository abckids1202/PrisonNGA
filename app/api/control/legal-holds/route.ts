import { getD1 } from "../../../../db/runtime";
import { createLegalHoldStatements, legalHoldTargetExists, releaseLegalHoldStatements } from "../../../../lib/server/legal-hold-workflow";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("audit.read");
    const d1 = await getD1();
    const result = await d1.prepare("SELECT id, entity_type, entity_id, reason, status, created_by, released_by, released_at, created_at FROM legal_holds WHERE facility_id = ? ORDER BY created_at DESC").bind(authorization.facilityId).all();
    return securityResponse({ holds: result.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("legal_hold.manage");
    const body = await request.json() as { action?: unknown; entityType?: unknown; entityId?: unknown; reason?: unknown; holdId?: unknown };
    const action = body.action === "RELEASE" ? "RELEASE" : body.action === "CREATE" ? "CREATE" : "";
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const now = new Date().toISOString();
    if (action === "CREATE") {
      const entityType = typeof body.entityType === "string" ? body.entityType.trim().slice(0, 80) : "";
      const entityId = typeof body.entityId === "string" ? body.entityId.trim() : "";
      if (!entityType || !entityId) throw new SecurityError("LEGAL_HOLD_ENTITY_REQUIRED", 400);
      if (!(await legalHoldTargetExists(d1, authorization.facilityId, entityType, entityId))) throw new SecurityError("LEGAL_HOLD_TARGET_NOT_FOUND", 404);
      const reason = assertReason(body.reason);
      await requireStepUp({ purpose: "legal_hold_change", userId: authorization.userId, targetId: `${authorization.facilityId}:${entityType}:${entityId}`, payload: { action, entityType, entityId, reason } });
      const scope = `legal-hold:create:${authorization.facilityId}:${authorization.userId}`;
      const requestHash = await hashIdempotencyPayload({ action, entityType, entityId, reason });
      const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
      if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
      idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
      const id = crypto.randomUUID();
      const correlationId = crypto.randomUUID();
      const event = { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Auditor", facilityId: authorization.facilityId, actionType: "LEGAL_HOLD_CREATED", entityType, entityId, reason, newValues: { status: "ACTIVE" }, requestId: context.requestId, correlationId, eventType: "LEGAL_HOLD_CREATED", payload: { legalHoldId: id, entityType, entityId } };
      const responseBody = { id, status: "ACTIVE", correlationId };
      const results = await d1.batch([...createLegalHoldStatements(d1, { id, facilityId: authorization.facilityId, entityType, entityId, reason, actorUserId: authorization.userId, now }, event), completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM legal_holds WHERE id = ? AND facility_id = ? AND status = 'ACTIVE')", values: [id, authorization.facilityId] } })]);
      if (!results[0]?.meta.changes || !results[results.length - 1]?.meta.changes) throw new SecurityError("LEGAL_HOLD_CREATE_FAILED", 409);
      return securityResponse(responseBody, 201, context.requestId);
    }
    const holdId = typeof body.holdId === "string" ? body.holdId.trim() : "";
    if (!holdId) throw new SecurityError("LEGAL_HOLD_REQUIRED", 400);
    const reason = assertReason(body.reason);
    const hold = await d1.prepare("SELECT id, entity_type, entity_id, status FROM legal_holds WHERE id = ? AND facility_id = ?").bind(holdId, authorization.facilityId).first<{ id: string; entity_type: string; entity_id: string; status: string }>();
    if (!hold) throw new SecurityError("LEGAL_HOLD_NOT_FOUND", 404);
    const scope = `legal-hold:release:${authorization.facilityId}:${authorization.userId}:${holdId}`;
    const requestHash = await hashIdempotencyPayload({ action: "RELEASE", holdId, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    if (hold.status === "RELEASED") {
      const responseBody = { id: holdId, status: "RELEASED", idempotent: true };
      const completed = await d1.prepare("UPDATE idempotency_records SET status = 'COMPLETED', processing_started_at = NULL, response_status = ?, response_body = ?, completed_at = ? WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'").bind(200, JSON.stringify(responseBody), now, idempotency.claimId, idempotency.scope, idempotency.key).run();
      if (!completed.meta.changes) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
      return securityResponse(responseBody, 200, context.requestId);
    }
    await requireStepUp({ purpose: "legal_hold_change", userId: authorization.userId, targetId: `${authorization.facilityId}:legal_hold:${holdId}`, payload: { action: "RELEASE", holdId, reason } });
    const correlationId = crypto.randomUUID();
    const event = { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Auditor", facilityId: authorization.facilityId, actionType: "LEGAL_HOLD_RELEASED", entityType: hold.entity_type, entityId: hold.entity_id, reason, oldValues: { status: "ACTIVE" }, newValues: { status: "RELEASED" }, requestId: context.requestId, correlationId, eventType: "LEGAL_HOLD_RELEASED", payload: { legalHoldId: holdId } };
    const responseBody = { id: holdId, status: "RELEASED", correlationId };
    const results = await d1.batch([...releaseLegalHoldStatements(d1, { id: holdId, facilityId: authorization.facilityId, entityType: hold.entity_type, entityId: hold.entity_id, actorUserId: authorization.userId, now }, event), completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM legal_holds WHERE id = ? AND facility_id = ? AND status = 'RELEASED')", values: [holdId, authorization.facilityId] } })]);
    if (!results[0]?.meta.changes) {
      const latest = await d1.prepare("SELECT status FROM legal_holds WHERE id = ? AND facility_id = ?").bind(holdId, authorization.facilityId).first<{ status: string }>();
      if (latest?.status === "RELEASED") throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
      throw new SecurityError("LEGAL_HOLD_RELEASE_CONFLICT", 409);
    }
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original legal-hold error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
