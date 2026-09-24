import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getD1 } from "../../../../db/runtime";
import { facilities } from "../../../../db/schema";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const allowedStates = ["NORMAL_OPERATIONS", "LIMITED_OPERATIONS", "LOCKDOWN", "EMERGENCY_CLOSURE", "TECHNICAL_DEGRADATION"] as const;
type FacilityState = typeof allowedStates[number];

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const db = await getDb();
    const [facility] = await db.select().from(facilities).where(eq(facilities.id, authorization.facilityId)).limit(1);
    return securityResponse({ facility }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let database: D1Database | null = null;
  let stateClaim: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("facility.state.change");
    const body = await request.json() as { state?: string; reason?: string; expectedVersion?: number };
    if (!allowedStates.includes(body.state as FacilityState)) throw new SecurityError("INVALID_FACILITY_STATE", 400);
    const reason = assertReason(body.reason);
    const db = await getDb();
    const [current] = await db.select().from(facilities).where(eq(facilities.id, authorization.facilityId)).limit(1);
    if (!current) throw new SecurityError("FACILITY_NOT_FOUND", 404);
    const d1 = await getD1();
    database = d1;
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const idempotencyScope = `facility-state:${authorization.facilityId}:${authorization.userId}`;
    const requestHash = await hashIdempotencyPayload({ state: body.state, reason, expectedVersion: body.expectedVersion ?? current.version });
    const claim = await claimIdempotency(d1, { scope: idempotencyScope, key: idempotencyKey, requestHash });
    if ("replay" in claim) return securityResponse(claim.replay.body, claim.replay.status, context.requestId);
    stateClaim = { claimId: claim.claimId, scope: idempotencyScope, key: idempotencyKey };
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw new SecurityError("STALE_FACILITY_STATE", 409);
    if (body.state === "LOCKDOWN" || body.state === "EMERGENCY_CLOSURE") await requireStepUp({
      purpose: `facility_state:${body.state}`,
      userId: authorization.userId,
      targetId: authorization.facilityId,
      payload: { state: body.state, reason, expectedVersion: body.expectedVersion ?? current.version },
    });
    if (current.currentState === body.state) {
      const responseBody = { facility: current, changed: false };
      await d1.batch([completeIdempotencyStatement(d1, { ...stateClaim, status: 200, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM facilities WHERE id = ? AND version = ?)", values: [authorization.facilityId, current.version] } })]);
      stateClaim = null;
      return securityResponse(responseBody, 200, context.requestId);
    }
    const nextVersion = current.version + 1;
    const changedAt = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const results = await d1.batch([
      d1.prepare(`UPDATE facilities
        SET current_state = ?, state_reason = ?, state_changed_at = ?, state_changed_by = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ?`)
        .bind(body.state, reason, changedAt, authorization.userId, nextVersion, changedAt, authorization.facilityId, current.version),
      d1.prepare(`INSERT INTO audit_events
        (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), authorization.userId, authorization.roles[0] || null, authorization.facilityId, "FACILITY_STATE_CHANGED", "facility", authorization.facilityId, reason, JSON.stringify({ state: current.currentState, version: current.version }), JSON.stringify({ state: body.state, version: nextVersion }), correlationId, context.requestId, changedAt),
      d1.prepare(`INSERT INTO outbox_events
        (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), body.state === "LOCKDOWN" ? "LOCKDOWN_STARTED" : "FACILITY_STATE_CHANGED", "facility", authorization.facilityId, authorization.facilityId, JSON.stringify({ previousState: current.currentState, nextState: body.state, reason }), correlationId, changedAt),
      completeIdempotencyStatement(d1, { ...stateClaim, status: 200, body: { facility: { ...current, currentState: body.state, stateReason: reason, version: nextVersion }, changed: true, correlationId }, guard: { sql: "EXISTS (SELECT 1 FROM facilities WHERE id = ? AND version = ?)", values: [authorization.facilityId, nextVersion] } }),
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("STALE_FACILITY_STATE", 409);
    stateClaim = null;
    const [facility] = await db.select().from(facilities).where(eq(facilities.id, authorization.facilityId)).limit(1);
    return securityResponse({ facility, changed: true, correlationId }, 200, context.requestId);
  } catch (error) {
    if (database && stateClaim) await releaseIdempotencyClaim(database, stateClaim).catch(() => undefined);
    return securityErrorResponse(error, context.requestId);
  }
}
