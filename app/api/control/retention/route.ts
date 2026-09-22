import { getD1 } from "../../../../db/runtime";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { appendAuditAndOutbox } from "../../../../lib/server/events";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("audit.read");
    const d1 = await getD1();
    const result = await d1.prepare("SELECT id, evidence_type, retention_days, version, effective_at, created_by, created_at, updated_at FROM retention_policies WHERE facility_id = ? ORDER BY evidence_type").bind(authorization.facilityId).all();
    return securityResponse({ policies: result.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.state.change");
    const body = await request.json() as { evidenceType?: unknown; retentionDays?: unknown; reason?: unknown };
    const evidenceType = typeof body.evidenceType === "string" ? body.evidenceType.trim().slice(0, 80) : "";
    const retentionDays = Number(body.retentionDays);
    if (!evidenceType || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new SecurityError("INVALID_RETENTION_POLICY", 400);
    const reason = assertReason(body.reason);
    await requireStepUp({ purpose: "retention_policy_change", userId: authorization.userId, targetId: `${authorization.facilityId}:${evidenceType}`, payload: { evidenceType, retentionDays, reason } });
    const d1 = await getD1();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await d1.prepare("INSERT INTO retention_policies (id, facility_id, evidence_type, retention_days, version, effective_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(facility_id, evidence_type) DO UPDATE SET retention_days = excluded.retention_days, version = retention_policies.version + 1, effective_at = excluded.effective_at, created_by = excluded.created_by, updated_at = excluded.updated_at").bind(id, authorization.facilityId, evidenceType, retentionDays, now, authorization.userId, now, now).run();
    await appendAuditAndOutbox({ actorUserId: authorization.userId, actorRole: "Supervisor", facilityId: authorization.facilityId, actionType: "RETENTION_POLICY_CHANGED", entityType: "retention_policy", entityId: `${authorization.facilityId}:${evidenceType}`, reason, newValues: { evidenceType, retentionDays, effectiveAt: now }, requestId: context.requestId, correlationId: crypto.randomUUID(), eventType: "RETENTION_POLICY_CHANGED", payload: { evidenceType, retentionDays } });
    return securityResponse({ evidenceType, retentionDays, effectiveAt: now }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
