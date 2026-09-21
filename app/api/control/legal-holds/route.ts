import { getD1 } from "../../../../db/runtime";
import { appendAuditAndOutbox } from "../../../../lib/server/events";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

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
      const reason = assertReason(body.reason);
      const id = crypto.randomUUID();
      await d1.prepare("INSERT INTO legal_holds (id, facility_id, entity_type, entity_id, reason, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)").bind(id, authorization.facilityId, entityType, entityId, reason, authorization.userId, now, now).run();
      await d1.prepare("UPDATE evidence_documents SET legal_hold = 1, updated_at = ? WHERE facility_id = ? AND ((? = 'verification_case' AND verification_case_id = ?) OR (? = 'evidence_document' AND id = ?))").bind(now, authorization.facilityId, entityType, entityId, entityType, entityId).run();
      await appendAuditAndOutbox({ actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Auditor", facilityId: authorization.facilityId, actionType: "LEGAL_HOLD_CREATED", entityType, entityId, reason, newValues: { status: "ACTIVE" }, requestId: context.requestId, correlationId: crypto.randomUUID(), eventType: "LEGAL_HOLD_CREATED", payload: { entityType, entityId } });
      return securityResponse({ id, status: "ACTIVE" }, 201, context.requestId);
    }
    const holdId = typeof body.holdId === "string" ? body.holdId.trim() : "";
    if (!holdId) throw new SecurityError("LEGAL_HOLD_REQUIRED", 400);
    const reason = assertReason(body.reason);
    const hold = await d1.prepare("SELECT id, entity_type, entity_id, status FROM legal_holds WHERE id = ? AND facility_id = ?").bind(holdId, authorization.facilityId).first<{ id: string; entity_type: string; entity_id: string; status: string }>();
    if (!hold) throw new SecurityError("LEGAL_HOLD_NOT_FOUND", 404);
    if (hold.status === "RELEASED") return securityResponse({ id: holdId, status: "RELEASED", idempotent: true }, 200, context.requestId);
    await d1.prepare("UPDATE legal_holds SET status = 'RELEASED', released_by = ?, released_at = ?, updated_at = ? WHERE id = ? AND facility_id = ? AND status = 'ACTIVE'").bind(authorization.userId, now, now, holdId, authorization.facilityId).run();
    const remaining = await d1.prepare("SELECT 1 FROM legal_holds WHERE facility_id = ? AND entity_type = ? AND entity_id = ? AND status = 'ACTIVE' LIMIT 1").bind(authorization.facilityId, hold.entity_type, hold.entity_id).first();
    if (!remaining) await d1.prepare("UPDATE evidence_documents SET legal_hold = 0, updated_at = ? WHERE facility_id = ? AND ((? = 'verification_case' AND verification_case_id = ?) OR (? = 'evidence_document' AND id = ?))").bind(now, authorization.facilityId, hold.entity_type, hold.entity_id, hold.entity_type, hold.entity_id).run();
    await appendAuditAndOutbox({ actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Auditor", facilityId: authorization.facilityId, actionType: "LEGAL_HOLD_RELEASED", entityType: hold.entity_type, entityId: hold.entity_id, reason, requestId: context.requestId, correlationId: crypto.randomUUID(), eventType: "LEGAL_HOLD_RELEASED", payload: { holdId } });
    return securityResponse({ id: holdId, status: "RELEASED" }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
