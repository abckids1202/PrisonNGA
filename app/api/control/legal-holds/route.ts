import { getD1 } from "../../../../db/runtime";
import { createLegalHoldStatements, legalHoldTargetExists, releaseLegalHoldStatements } from "../../../../lib/server/legal-hold-workflow";
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
  try {
    const authorization = await requirePermission("audit.read");
    const body = await request.json() as { action?: unknown; entityType?: unknown; entityId?: unknown; reason?: unknown; holdId?: unknown };
    const action = body.action === "RELEASE" ? "RELEASE" : body.action === "CREATE" ? "CREATE" : "";
    const d1 = await getD1();
    const now = new Date().toISOString();
    if (action === "CREATE") {
      const entityType = typeof body.entityType === "string" ? body.entityType.trim().slice(0, 80) : "";
      const entityId = typeof body.entityId === "string" ? body.entityId.trim() : "";
      if (!entityType || !entityId) throw new SecurityError("LEGAL_HOLD_ENTITY_REQUIRED", 400);
      if (!(await legalHoldTargetExists(d1, authorization.facilityId, entityType, entityId))) throw new SecurityError("LEGAL_HOLD_TARGET_NOT_FOUND", 404);
      const reason = assertReason(body.reason);
      await requireStepUp({ purpose: "legal_hold_change", userId: authorization.userId, targetId: `${authorization.facilityId}:${entityType}:${entityId}`, payload: { action, entityType, entityId, reason } });
      const id = crypto.randomUUID();
      const correlationId = crypto.randomUUID();
      const event = { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Auditor", facilityId: authorization.facilityId, actionType: "LEGAL_HOLD_CREATED", entityType, entityId, reason, newValues: { status: "ACTIVE" }, requestId: context.requestId, correlationId, eventType: "LEGAL_HOLD_CREATED", payload: { legalHoldId: id, entityType, entityId } };
      await d1.batch(createLegalHoldStatements(d1, { id, facilityId: authorization.facilityId, entityType, entityId, reason, actorUserId: authorization.userId, now }, event));
      return securityResponse({ id, status: "ACTIVE" }, 201, context.requestId);
    }
    const holdId = typeof body.holdId === "string" ? body.holdId.trim() : "";
    if (!holdId) throw new SecurityError("LEGAL_HOLD_REQUIRED", 400);
    const reason = assertReason(body.reason);
    const hold = await d1.prepare("SELECT id, entity_type, entity_id, status FROM legal_holds WHERE id = ? AND facility_id = ?").bind(holdId, authorization.facilityId).first<{ id: string; entity_type: string; entity_id: string; status: string }>();
    if (!hold) throw new SecurityError("LEGAL_HOLD_NOT_FOUND", 404);
    if (hold.status === "RELEASED") return securityResponse({ id: holdId, status: "RELEASED", idempotent: true }, 200, context.requestId);
    await requireStepUp({ purpose: "legal_hold_change", userId: authorization.userId, targetId: `${authorization.facilityId}:legal_hold:${holdId}`, payload: { action: "RELEASE", holdId, reason } });
    const correlationId = crypto.randomUUID();
    const event = { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Auditor", facilityId: authorization.facilityId, actionType: "LEGAL_HOLD_RELEASED", entityType: hold.entity_type, entityId: hold.entity_id, reason, oldValues: { status: "ACTIVE" }, newValues: { status: "RELEASED" }, requestId: context.requestId, correlationId, eventType: "LEGAL_HOLD_RELEASED", payload: { legalHoldId: holdId } };
    const results = await d1.batch(releaseLegalHoldStatements(d1, { id: holdId, facilityId: authorization.facilityId, entityType: hold.entity_type, entityId: hold.entity_id, actorUserId: authorization.userId, now }, event));
    if (!results[0]?.meta.changes) {
      const latest = await d1.prepare("SELECT status FROM legal_holds WHERE id = ? AND facility_id = ?").bind(holdId, authorization.facilityId).first<{ status: string }>();
      if (latest?.status === "RELEASED") return securityResponse({ id: holdId, status: "RELEASED", idempotent: true }, 200, context.requestId);
      throw new SecurityError("LEGAL_HOLD_RELEASE_CONFLICT", 409);
    }
    return securityResponse({ id: holdId, status: "RELEASED" }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
