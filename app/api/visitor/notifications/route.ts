import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const result = await d1.prepare("SELECT id, channel, template, title, body, payload, status, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").bind(visitor.userId).all();
    return securityResponse({ notifications: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PATCH(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { notificationIds?: unknown[] };
    const ids = Array.isArray(body.notificationIds) ? [...new Set(body.notificationIds.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9-]{10,80}$/.test(id)))].slice(0, 50).sort() : [];
    if (!ids.length) throw new SecurityError("NOTIFICATION_IDS_REQUIRED", 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const now = new Date().toISOString();
    const database = await getD1();
    d1 = database;
    await enforceRateLimit(database, { key: `visitor-notification-update:${visitor.userId}`, limit: 60, windowSeconds: 60 });
    const scope = `visitor-notifications-read:${visitor.userId}`;
    const requestHash = await hashIdempotencyPayload({ notificationIds: ids });
    const claimed: IdempotencyClaim = await claimIdempotency(database, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    const responseBody = { ok: true, markedRead: ids.length };
    const results = await d1.batch([
      ...ids.map((id) => database.prepare("UPDATE notifications SET status = 'READ', read_at = ? WHERE id = ? AND user_id = ? AND status != 'READ'").bind(now, id, visitor.userId)),
      ...auditAndOutboxStatements(database, {
        actorUserId: visitor.userId,
        actorRole: "VISITOR",
        facilityId: null,
        actionType: "VISITOR_NOTIFICATIONS_READ",
        entityType: "notification_batch",
        entityId: idempotencyKey,
        reason: "Visitor marked notifications as read.",
        newValues: { notificationCount: ids.length },
        requestId: context.requestId,
        eventType: "VISITOR_NOTIFICATIONS_READ",
        payload: { userId: visitor.userId, notificationCount: ids.length },
      }),
      completeIdempotencyStatement(database, { ...idempotency, status: 200, body: responseBody }),
    ]);
    if (!results[results.length - 1]?.meta.changes) throw new SecurityError("NOTIFICATION_UPDATE_CONFLICT", 409);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original notification error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
