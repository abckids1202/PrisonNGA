import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { parseEditableVisitPolicy } from "../../../../lib/server/visit-policy-admin";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

type PolicyRow = {
  id: string;
  facility_id: string;
  min_duration_minutes: number;
  max_duration_minutes: number;
  min_advance_minutes: number;
  max_advance_days: number;
  daily_start_time: string;
  daily_end_time: string;
  version: number;
  updated_at: string;
};

const selectPolicy = `SELECT id, facility_id, min_duration_minutes, max_duration_minutes, min_advance_minutes,
  max_advance_days, daily_start_time, daily_end_time, version, updated_at FROM visit_policies WHERE facility_id = ?`;

function toPublicPolicy(row: PolicyRow) {
  return {
    id: row.id,
    facilityId: row.facility_id,
    minDurationMinutes: row.min_duration_minutes,
    maxDurationMinutes: row.max_duration_minutes,
    minAdvanceMinutes: row.min_advance_minutes,
    maxAdvanceDays: row.max_advance_days,
    dailyStartTime: row.daily_start_time,
    dailyEndTime: row.daily_end_time,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const policy = await d1.prepare(selectPolicy).bind(authorization.facilityId).first<PolicyRow>();
    if (!policy) throw new SecurityError("FACILITY_POLICY_NOT_CONFIGURED", 404);
    const history = await d1.prepare(`SELECT version, actor_user_id, reason, snapshot, created_at
      FROM visit_policy_history WHERE facility_id = ? ORDER BY version DESC LIMIT 20`).bind(authorization.facilityId).all();
    return securityResponse({ policy: toPublicPolicy(policy), history: history.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PUT(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("facility.state.change");
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
      body = parsed as Record<string, unknown>;
    } catch {
      throw new SecurityError("INVALID_REQUEST_BODY", 400);
    }
    const policy = parseEditableVisitPolicy(body.policy);
    const reason = assertReason(body.reason);
    const expectedVersion = body.expectedVersion;
    if (!policy) throw new SecurityError("INVALID_VISIT_POLICY", 400);
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const database = await getD1();
    d1 = database;
    const current = await database.prepare(selectPolicy).bind(authorization.facilityId).first<PolicyRow>();
    if (!current) throw new SecurityError("FACILITY_POLICY_NOT_CONFIGURED", 404);
    const scope = `visit-policy:${authorization.facilityId}`;
    const requestHash = await hashIdempotencyPayload({ policy, reason, expectedVersion });
    const claimed: IdempotencyClaim = await claimIdempotency(database, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    if (current.version !== expectedVersion) throw new SecurityError("STALE_POLICY", 409);
    await requireStepUp({ purpose: "visit_policy_change", userId: authorization.userId, targetId: current.id, payload: { policy, reason, expectedVersion } });

    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const nextSnapshot = { ...policy, version: nextVersion };
    const correlationId = crypto.randomUUID();
    const writeGuard = { sql: "changes() > 0", values: [] };
    const responseBody = { policy: { ...nextSnapshot, facilityId: authorization.facilityId, id: current.id, updatedAt: now }, correlationId };
    const statements = await database.batch([
      database.prepare(`UPDATE visit_policies SET min_duration_minutes = ?, max_duration_minutes = ?,
        min_advance_minutes = ?, max_advance_days = ?, daily_start_time = ?, daily_end_time = ?,
        version = version + 1, updated_at = ? WHERE facility_id = ? AND version = ?`)
        .bind(policy.minDurationMinutes, policy.maxDurationMinutes, policy.minAdvanceMinutes, policy.maxAdvanceDays,
          policy.dailyStartTime, policy.dailyEndTime, now, authorization.facilityId, current.version),
      database.prepare(`INSERT INTO visit_policy_history (id, facility_id, version, actor_user_id, reason, snapshot, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), authorization.facilityId, nextVersion, authorization.userId, reason,
          JSON.stringify(nextSnapshot), now),
      ...auditAndOutboxStatements(database, {
        actorUserId: authorization.userId,
        actorRole: authorization.roles[0] || null,
        facilityId: authorization.facilityId,
        actionType: "VISIT_POLICY_UPDATED",
        entityType: "visit_policy",
        entityId: current.id,
        reason,
        oldValues: toPublicPolicy(current),
        newValues: nextSnapshot,
        requestId: context.requestId,
        correlationId,
        eventType: "VISIT_POLICY_UPDATED",
        payload: { facilityId: authorization.facilityId, version: nextVersion },
      }, writeGuard),
      completeIdempotencyStatement(database, { ...idempotency, status: 200, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM visit_policies WHERE facility_id = ? AND version = ?)", values: [authorization.facilityId, nextVersion] } }),
    ]);
    if (!statements[0]?.meta.changes || !statements[statements.length - 1]?.meta.changes) throw new SecurityError("STALE_POLICY", 409);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original policy error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
