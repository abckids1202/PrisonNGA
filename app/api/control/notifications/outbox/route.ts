import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("notification.manage");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT id, event_type, aggregate_type, aggregate_id, payload, correlation_id, status, attempt_count, available_at, last_error, created_at FROM outbox_events WHERE facility_id = ? AND status IN ('FAILED', 'DEAD_LETTER') ORDER BY created_at DESC LIMIT 100`).bind(authorization.facilityId).all();
    return securityResponse({ events: result.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("notification.manage");
    const body = await request.json() as { outboxEventId?: unknown; reason?: unknown };
    const outboxEventId = typeof body.outboxEventId === "string" ? body.outboxEventId.trim() : "";
    if (!outboxEventId) throw new SecurityError("OUTBOX_EVENT_REQUIRED", 400);
    const reason = assertReason(body.reason);
    const d1 = await getD1();
    const event = await d1.prepare("SELECT id, event_type, aggregate_type, aggregate_id, status, attempt_count FROM outbox_events WHERE id = ? AND facility_id = ?").bind(outboxEventId, authorization.facilityId).first<{ id: string; event_type: string; aggregate_type: string; aggregate_id: string | null; status: string; attempt_count: number }>();
    if (!event) throw new SecurityError("OUTBOX_EVENT_NOT_FOUND", 404);
    if (event.status !== "DEAD_LETTER" && event.status !== "FAILED") throw new SecurityError("OUTBOX_EVENT_NOT_REPLAYABLE", 409);
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const guard = { sql: "id = ? AND facility_id = ? AND status IN ('FAILED', 'DEAD_LETTER')", values: [outboxEventId, authorization.facilityId] };
    const results = await d1.batch([
      d1.prepare("UPDATE outbox_events SET status = 'PENDING', attempt_count = 0, available_at = ?, last_error = NULL, processed_at = NULL WHERE id = ? AND facility_id = ? AND status IN ('FAILED', 'DEAD_LETTER')").bind(now, outboxEventId, authorization.facilityId),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: authorization.facilityId, actionType: "OUTBOX_EVENT_REPLAYED", entityType: "outbox_event", entityId: outboxEventId, reason, oldValues: { status: event.status, attemptCount: event.attempt_count }, newValues: { status: "PENDING", attemptCount: 0 }, requestId: context.requestId, correlationId, eventType: "OUTBOX_EVENT_REPLAYED", payload: { replayedEventId: outboxEventId, eventType: event.event_type } }, guard),
    ]);
    if (!results[0]?.meta?.changes) throw new SecurityError("OUTBOX_EVENT_REPLAY_RACE", 409);
    return securityResponse({ outboxEventId, status: "PENDING" }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
