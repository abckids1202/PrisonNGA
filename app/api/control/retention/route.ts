import { getD1 } from "../../../../db/runtime";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { auditAndOutboxStatements } from "../../../../lib/server/events";

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
    const body = await request.json() as { evidenceType?: unknown; retentionDays?: unknown; expectedVersion?: unknown; reason?: unknown };
    const evidenceType = typeof body.evidenceType === "string" ? body.evidenceType.trim().slice(0, 80) : "";
    const retentionDays = Number(body.retentionDays);
    const requestedVersion = body.expectedVersion === undefined ? null : Number(body.expectedVersion);
    if (!evidenceType || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new SecurityError("INVALID_RETENTION_POLICY", 400);
    if (requestedVersion !== null && (!Number.isInteger(requestedVersion) || requestedVersion < 1)) throw new SecurityError("INVALID_RETENTION_POLICY_VERSION", 400);
    const reason = assertReason(body.reason);
    await requireStepUp({ purpose: "retention_policy_change", userId: authorization.userId, targetId: `${authorization.facilityId}:${evidenceType}`, payload: { evidenceType, retentionDays, reason } });
    const d1 = await getD1();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const current = await d1.prepare("SELECT version, retention_days FROM retention_policies WHERE facility_id = ? AND evidence_type = ?").bind(authorization.facilityId, evidenceType).first<{ version: number; retention_days: number }>();
    const expectedVersion = requestedVersion ?? current?.version ?? null;
    const correlationId = crypto.randomUUID();
    const mutation = current
      ? d1.prepare("UPDATE retention_policies SET retention_days = ?, version = version + 1, effective_at = ?, created_by = ?, updated_at = ? WHERE facility_id = ? AND evidence_type = ? AND version = ?")
        .bind(retentionDays, now, authorization.userId, now, authorization.facilityId, evidenceType, expectedVersion)
      : d1.prepare(`INSERT INTO retention_policies (id, facility_id, evidence_type, retention_days, version, effective_at, created_by, created_at, updated_at)
        SELECT ?, ?, ?, ?, 1, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM retention_policies WHERE facility_id = ? AND evidence_type = ?)`)
        .bind(id, authorization.facilityId, evidenceType, retentionDays, now, authorization.userId, now, now, authorization.facilityId, evidenceType);
    const results = await d1.batch([
      mutation,
      ...auditAndOutboxStatements(d1, {
        actorUserId: authorization.userId,
        actorRole: "Supervisor",
        facilityId: authorization.facilityId,
        actionType: "RETENTION_POLICY_CHANGED",
        entityType: "retention_policy",
        entityId: `${authorization.facilityId}:${evidenceType}`,
        reason,
        oldValues: current ? { retentionDays: current.retention_days, version: current.version } : null,
        newValues: { evidenceType, retentionDays, effectiveAt: now, expectedVersion },
        requestId: context.requestId,
        correlationId,
        eventType: "RETENTION_POLICY_CHANGED",
        payload: { evidenceType, retentionDays, expectedVersion },
      }, { sql: "changes() > 0", values: [] }),
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("RETENTION_POLICY_CONFLICT", 409);
    return securityResponse({ evidenceType, retentionDays, effectiveAt: now, version: (current?.version || 0) + 1 }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
