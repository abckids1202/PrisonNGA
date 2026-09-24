import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("notification.manage");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT id, event_type, aggregate_type, aggregate_id, correlation_id, status, attempt_count, available_at, last_error, created_at FROM outbox_events WHERE facility_id = ? AND status IN ('FAILED', 'DEAD_LETTER') ORDER BY created_at DESC LIMIT 100`).bind(authorization.facilityId).all<{ id: string; event_type: string; aggregate_type: string; aggregate_id: string | null; correlation_id: string; status: string; attempt_count: number; available_at: string; last_error: string | null; created_at: string }>();
    const events = await Promise.all(result.results.map(async (event) => {
      const attempts = await d1.prepare(`SELECT id, notification_id, channel, attempt_number, status, error_message, started_at, finished_at FROM notification_delivery_attempts WHERE outbox_event_id = ? ORDER BY attempt_number DESC, channel ASC`).bind(event.id).all();
      return { ...event, deliveryAttempts: attempts.results };
    }));
    return securityResponse({ events }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let databaseRef: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("notification.manage");
    const body = await request.json() as { outboxEventId?: unknown; reason?: unknown };
    const outboxEventId = typeof body.outboxEventId === "string" ? body.outboxEventId.trim() : "";
    if (!outboxEventId) throw new SecurityError("OUTBOX_EVENT_REQUIRED", 400);
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const database = await getD1();
    databaseRef = database;
    const d1 = database;
    const event = await d1.prepare("SELECT id, event_type, aggregate_type, aggregate_id, status, attempt_count FROM outbox_events WHERE id = ? AND facility_id = ?").bind(outboxEventId, authorization.facilityId).first<{ id: string; event_type: string; aggregate_type: string; aggregate_id: string | null; status: string; attempt_count: number }>();
    if (!event) throw new SecurityError("OUTBOX_EVENT_NOT_FOUND", 404);
    const scope = `outbox-replay:${authorization.facilityId}:${outboxEventId}`;
    const requestHash = await hashIdempotencyPayload({ outboxEventId, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(database, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    if (event.status !== "DEAD_LETTER" && event.status !== "FAILED") throw new SecurityError("OUTBOX_EVENT_NOT_REPLAYABLE", 409);
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    // The audit/outbox statements run after the replay update in the same D1
    // batch, so the guard must assert the post-transition state.
    const guard = { sql: "EXISTS (SELECT 1 FROM outbox_events WHERE id = ? AND facility_id = ? AND status = 'PENDING' AND attempt_count = 0)", values: [outboxEventId, authorization.facilityId] };
    const results = await d1.batch([
      d1.prepare("UPDATE outbox_events SET status = 'PENDING', attempt_count = 0, available_at = ?, processing_started_at = NULL, last_error = NULL, processed_at = NULL WHERE id = ? AND facility_id = ? AND status IN ('FAILED', 'DEAD_LETTER')").bind(now, outboxEventId, authorization.facilityId),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: "OUTBOX_EVENT_REPLAYED", entityType: "outbox_event", entityId: outboxEventId, reason, oldValues: { status: event.status, attemptCount: event.attempt_count }, newValues: { status: "PENDING", attemptCount: 0 }, requestId: context.requestId, correlationId, eventType: "OUTBOX_EVENT_REPLAYED", payload: { replayedEventId: outboxEventId, eventType: event.event_type } }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: { outboxEventId, status: "PENDING", correlationId }, guard }),
    ]);
    if (!results[0]?.meta?.changes || !results[results.length - 1]?.meta?.changes) throw new SecurityError("OUTBOX_EVENT_REPLAY_RACE", 409);
    idempotency = null;
    return securityResponse({ outboxEventId, status: "PENDING", correlationId }, 200, context.requestId);
  } catch (error) {
    if (databaseRef && idempotency) {
      try { await releaseIdempotencyClaim(databaseRef, idempotency); } catch { /* Preserve the original outbox error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
