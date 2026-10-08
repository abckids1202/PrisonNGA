import { getD1 } from "../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("staff.manage");
    const d1 = await getD1();
    const now = new Date().toISOString();
    const result = await d1.prepare(`SELECT
        s.id,
        s.user_id,
        u.display_name,
        u.email,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        CASE WHEN s.user_agent_hash IS NULL THEN 0 ELSE 1 END AS recognized_browser
      FROM auth_sessions s
      INNER JOIN users u ON u.id = s.user_id AND u.user_type = 'STAFF'
      INNER JOIN staff_profiles sp ON sp.user_id = s.user_id AND sp.facility_id = ?
      WHERE s.revoked_at IS NULL AND julianday(s.expires_at) > julianday(?)
      ORDER BY s.last_seen_at DESC, s.created_at DESC
      LIMIT 250`).bind(authorization.facilityId, now).all();
    return securityResponse({ facilityId: authorization.facilityId, generatedAt: now, sessions: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("staff.manage");
    const body = await request.json() as { userId?: unknown; sessionId?: unknown; reason?: unknown };
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const reason = assertReason(body.reason);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!userId || !sessionId) throw new SecurityError("STAFF_SESSION_REQUIRED", 400);
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);

    d1 = await getD1();
    const target = await d1.prepare(`SELECT s.id, s.user_id, u.display_name, s.revoked_at
      FROM auth_sessions s
      INNER JOIN users u ON u.id = s.user_id AND u.user_type = 'STAFF'
      INNER JOIN staff_profiles sp ON sp.user_id = s.user_id AND sp.facility_id = ?
      WHERE s.id = ? AND s.user_id = ?`).bind(authorization.facilityId, sessionId, userId).first<{ id: string; user_id: string; display_name: string; revoked_at: string | null }>();
    if (!target) throw new SecurityError("STAFF_SESSION_NOT_FOUND", 404);

    const scope = `staff-session-revoke:${authorization.facilityId}:${sessionId}`;
    const requestHash = await hashIdempotencyPayload({ userId, sessionId, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };

    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { sessionId, userId, status: "REVOKED", correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM auth_sessions WHERE id = ? AND user_id = ? AND revoked_at = ?)", values: [sessionId, userId, now] };
    const results = await d1.batch([
      d1.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").bind(now, sessionId, userId),
      ...auditAndOutboxStatements(d1, {
        actorUserId: authorization.userId,
        actorRole: authorization.roles[0] || "Supervisor",
        facilityId: authorization.facilityId,
        actionType: "STAFF_SESSION_REVOKED",
        entityType: "auth_session",
        entityId: sessionId,
        reason,
        oldValues: { userId, displayName: target.display_name, status: "ACTIVE" },
        newValues: { userId, displayName: target.display_name, status: "REVOKED" },
        requestId: context.requestId,
        correlationId,
        eventType: "STAFF_SESSION_REVOKED",
        payload: { sessionId, userId },
      }, guard),
      completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody, guard }),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes || !results[2]?.meta.changes || !results[3]?.meta.changes) {
      throw new SecurityError("STAFF_SESSION_REVOCATION_INCOMPLETE", 503);
    }
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original session error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
