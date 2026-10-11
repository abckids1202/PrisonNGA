import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("finance.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT ppe.id, ppe.provider, ppe.event_key, ppe.event_type, ppe.status,
        ppe.attempt_count, ppe.available_at, ppe.last_error, ppe.created_at,
        pi.id AS payment_intent_id, pi.status AS payment_status
      FROM payment_provider_events ppe
      INNER JOIN payment_intents pi
        ON (pi.id = json_extract(ppe.payload, '$.paymentIntentId')
          OR pi.provider_reference = json_extract(ppe.payload, '$.providerReference'))
      INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR'
      WHERE pi.facility_id = ? AND ppe.status IN ('FAILED', 'DEAD_LETTER')
      ORDER BY ppe.created_at DESC LIMIT 100`).bind(authorization.facilityId).all();
    return securityResponse({ events: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let databaseRef: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("finance.manage");
    const body = await request.json() as { paymentEventId?: unknown; reason?: unknown };
    const paymentEventId = typeof body.paymentEventId === "string" ? body.paymentEventId.trim() : "";
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(paymentEventId)) throw new SecurityError("PAYMENT_EVENT_REQUIRED", 400);
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);

    const database = await getD1();
    databaseRef = database;
    const event = await database.prepare(`SELECT ppe.id, ppe.provider, ppe.event_key, ppe.event_type, ppe.status, ppe.attempt_count,
        pi.id AS payment_intent_id
      FROM payment_provider_events ppe
      INNER JOIN payment_intents pi
        ON (pi.id = json_extract(ppe.payload, '$.paymentIntentId')
          OR pi.provider_reference = json_extract(ppe.payload, '$.providerReference'))
      INNER JOIN users u ON u.id = pi.user_id AND u.user_type = 'VISITOR'
      WHERE ppe.id = ? AND pi.facility_id = ? LIMIT 1`).bind(paymentEventId, authorization.facilityId)
      .first<{ id: string; provider: string; event_key: string; event_type: string; status: string; attempt_count: number; payment_intent_id: string }>();
    if (!event) throw new SecurityError("PAYMENT_EVENT_NOT_FOUND", 404);
    if (event.status !== "FAILED" && event.status !== "DEAD_LETTER") throw new SecurityError("PAYMENT_EVENT_NOT_REPLAYABLE", 409);

    const payload = { paymentEventId, reason };
    await requireStepUp({ purpose: "payment_event_replay", userId: authorization.userId, targetId: paymentEventId, payload });
    const scope = `finance-payment-event-replay:${authorization.facilityId}:${paymentEventId}`;
    const requestHash = await hashIdempotencyPayload(payload);
    const claimed: IdempotencyClaim = await claimIdempotency(database, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };

    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const guard = { sql: "EXISTS (SELECT 1 FROM payment_provider_events WHERE id = ? AND status = 'RECEIVED' AND attempt_count = 0)", values: [paymentEventId] };
    const results = await database.batch([
      database.prepare(`UPDATE payment_provider_events SET status = 'RECEIVED', attempt_count = 0, available_at = ?, processing_started_at = NULL, last_error = NULL, processed_at = NULL WHERE id = ? AND status IN ('FAILED', 'DEAD_LETTER')`).bind(now, paymentEventId),
      ...auditAndOutboxStatements(database, {
        actorUserId: authorization.userId,
        actorRole: authorization.roles[0] || "Supervisor",
        facilityId: authorization.facilityId,
        actionType: "PAYMENT_PROVIDER_EVENT_REPLAYED",
        entityType: "payment_provider_event",
        entityId: paymentEventId,
        reason,
        oldValues: { status: event.status, attemptCount: event.attempt_count },
        newValues: { status: "RECEIVED", attemptCount: 0 },
        requestId: context.requestId,
        correlationId,
        eventType: "PAYMENT_PROVIDER_EVENT_REPLAYED",
        payload: { paymentEventId, paymentIntentId: event.payment_intent_id, provider: event.provider, eventKey: event.event_key, eventType: event.event_type },
      }, guard),
      completeIdempotencyStatement(database, { ...idempotency, status: 202, body: { paymentEventId, status: "RECEIVED", correlationId }, guard }),
    ]);
    if (!results.every((result) => result?.meta?.changes === 1)) throw new SecurityError("PAYMENT_EVENT_REPLAY_INCOMPLETE", 503);
    idempotency = null;
    return securityResponse({ paymentEventId, status: "RECEIVED", correlationId }, 202, context.requestId);
  } catch (error) {
    if (databaseRef && idempotency) {
      try { await releaseIdempotencyClaim(databaseRef, idempotency); } catch { /* Preserve the original finance error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
