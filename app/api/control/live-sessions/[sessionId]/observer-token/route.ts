import { getD1 } from "@/db/runtime";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "@/lib/server/security";
import { createLiveKitProvider, getVideoConfig } from "@/lib/server/video/provider";
import { assertSessionProvider, assertStaffObserverJoinAllowed, getStaffSession, sessionTokenTtlSeconds, toSessionPayload } from "@/lib/server/video/session";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "@/lib/server/idempotency";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("session.monitor");
    const { sessionId } = await context.params;
    const body = await request.json() as { reason?: string };
    const reason = assertReason(body.reason);
    const session = await getStaffSession(sessionId, authorization.facilityId);
    assertStaffObserverJoinAllowed(session);
    d1 = await getD1();
    await enforceRateLimit(d1, { key: `staff-observer-token:${authorization.facilityId}:${authorization.userId}:${sessionId}`, limit: 12, windowSeconds: 60 * 10 });
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const scope = `session-observer-token:${authorization.facilityId}:${authorization.userId}:${sessionId}`;
    const requestHash = await hashIdempotencyPayload({ sessionId, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, requestContext.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    const config = await getVideoConfig();
    if (!config.configured) throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
    assertSessionProvider(session, config.provider);
    const provider = await createLiveKitProvider();
    const expiresInSeconds = sessionTokenTtlSeconds(session);
    const token = await provider.createParticipantToken({ roomName: session.provider_room_name, identity: `observer:${authorization.userId}`, name: authorization.displayName, role: "STAFF_OBSERVER", ttlSeconds: expiresInSeconds });
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { token, serverUrl: config.url, session: toSessionPayload(session), participantRole: "STAFF_OBSERVER", expiresInSeconds };
    const auditResults = await d1.batch([
      d1.prepare(`INSERT INTO visit_session_events (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), sessionId, "MONITORING_TOKEN_ISSUED", "STAFF", "STAFF_OBSERVER", JSON.stringify({ reason, tokenTtlSeconds: expiresInSeconds }), correlationId, now),
      d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), authorization.userId, authorization.roles[0] || null, authorization.facilityId, "SESSION_MONITORING_TOKEN_ISSUED", "visit_session", sessionId, reason, null, JSON.stringify({ participantRole: "STAFF_OBSERVER", tokenTtlSeconds: expiresInSeconds }), correlationId, requestContext.requestId, now),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody }),
    ]);
    if (!auditResults[0]?.meta.changes || !auditResults[1]?.meta.changes || !auditResults[2]?.meta.changes) {
      throw new SecurityError("SESSION_MONITORING_AUDIT_FAILED", 503);
    }
    idempotency = null;
    return securityResponse(responseBody, 200, requestContext.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original observer error. */ }
    }
    return securityErrorResponse(error, requestContext.requestId);
  }
}
