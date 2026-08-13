import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getD1 } from "../../../../db/runtime";
import { facilities } from "../../../../db/schema";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

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
  try {
    const authorization = await requirePermission("facility.state.change");
    const body = await request.json() as { state?: string; reason?: string; expectedVersion?: number };
    if (!allowedStates.includes(body.state as FacilityState)) throw new SecurityError("INVALID_FACILITY_STATE", 400);
    const reason = assertReason(body.reason);
    const db = await getDb();
    const [current] = await db.select().from(facilities).where(eq(facilities.id, authorization.facilityId)).limit(1);
    if (!current) throw new SecurityError("FACILITY_NOT_FOUND", 404);
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw new SecurityError("STALE_FACILITY_STATE", 409);
    if (current.currentState === body.state) return securityResponse({ facility: current, changed: false }, 200, context.requestId);
    const nextVersion = current.version + 1;
    const changedAt = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const d1 = await getD1();
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
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("STALE_FACILITY_STATE", 409);
    const [facility] = await db.select().from(facilities).where(eq(facilities.id, authorization.facilityId)).limit(1);
    return securityResponse({ facility, changed: true, correlationId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
