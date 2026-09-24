import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../../../../db";
import { getD1 } from "../../../../db/runtime";
import { authSessions, users } from "../../../../db/schema";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { getRequestContext, getSecuritySalt, getVisitorSessionIdentity, getWorkspaceIdentity, hashIdentifier, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

async function currentUser() {
  const visitor = await getVisitorSessionIdentity();
  if (visitor) return { id: visitor.userId, tokenHash: await currentTokenHash() };
  const identity = await getWorkspaceIdentity();
  if (!identity) throw new SecurityError("AUTHENTICATION_REQUIRED", 401);
  const db = await getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.externalId, identity.externalId), eq(users.status, "ACTIVE"))).limit(1);
  if (!user) throw new SecurityError("ACCOUNT_NOT_PROVISIONED", 403);
  return { id: user.id, tokenHash: null };
}

async function currentTokenHash() {
  const token = (await cookies()).get("securevisit_session")?.value;
  return token ? hashIdentifier(token, await getSecuritySalt()) : null;
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const account = await currentUser();
    const db = await getDb();
    const sessions = await db.select({ id: authSessions.id, createdAt: authSessions.createdAt, expiresAt: authSessions.expiresAt, lastSeenAt: authSessions.lastSeenAt, revokedAt: authSessions.revokedAt, tokenHash: authSessions.tokenHash, userAgentKnown: authSessions.userAgentHash }).from(authSessions).where(and(eq(authSessions.userId, account.id), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date().toISOString())));
    return securityResponse({ sessions: sessions.map(({ tokenHash: sessionTokenHash, ...session }) => ({ ...session, deviceLabel: session.userAgentKnown ? "Recognized browser" : "Browser session", current: Boolean(account.tokenHash && sessionTokenHash === account.tokenHash) })) }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const account = await currentUser();
    const body = await request.json() as { sessionId?: unknown; revokeAll?: unknown };
    const normalized = body.revokeAll === true ? { revokeAll: true } : { revokeAll: false, sessionId: typeof body.sessionId === "string" ? body.sessionId.trim() : "" };
    if (!normalized.revokeAll && !normalized.sessionId) throw new SecurityError("SESSION_ID_REQUIRED", 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const scope = `auth-session-revoke:${account.id}`;
    const requestHash = await hashIdempotencyPayload(normalized);
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    const now = new Date().toISOString();
    const responseBody = { ok: true, revokedAt: now };
    if (normalized.revokeAll) {
      const results = await d1.batch([
        d1.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, account.id),
        d1.prepare("INSERT INTO security_events (id, user_id, event_type, severity, request_id, metadata, created_at) VALUES (?, ?, 'SESSION_REVOKED', 'WARNING', ?, ?, ?)").bind(crypto.randomUUID(), account.id, context.requestId, JSON.stringify({ revokeAll: true }), now),
        completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody }),
      ]);
      if (!results[results.length - 1]?.meta.changes) throw new SecurityError("SESSION_REVOCATION_CONFLICT", 409);
    } else {
      const results = await d1.batch([
        d1.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").bind(now, normalized.sessionId, account.id),
        d1.prepare("INSERT INTO security_events (id, user_id, event_type, severity, request_id, metadata, created_at) SELECT ?, ?, 'SESSION_REVOKED', 'WARNING', ?, ?, ? WHERE EXISTS (SELECT 1 FROM auth_sessions WHERE id = ? AND user_id = ? AND revoked_at = ?)")
          .bind(crypto.randomUUID(), account.id, context.requestId, JSON.stringify({ revokeAll: false, sessionId: normalized.sessionId }), now, normalized.sessionId, account.id, now),
        completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM auth_sessions WHERE id = ? AND user_id = ? AND revoked_at = ?)", values: [normalized.sessionId, account.id, now] } }),
      ]);
      if (!results[1]?.meta.changes) throw new SecurityError("SESSION_NOT_FOUND", 404);
      if (!results[results.length - 1]?.meta.changes) throw new SecurityError("SESSION_REVOCATION_CONFLICT", 409);
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
