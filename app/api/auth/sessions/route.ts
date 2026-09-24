import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../../../../db";
import { getD1 } from "../../../../db/runtime";
import { authSessions, users } from "../../../../db/schema";
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
  try {
    const account = await currentUser();
    const body = await request.json() as { sessionId?: unknown; revokeAll?: unknown };
    const d1 = await getD1();
    const now = new Date().toISOString();
    if (body.revokeAll === true) {
      await d1.batch([
        d1.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, account.id),
        d1.prepare("INSERT INTO security_events (id, user_id, event_type, severity, request_id, metadata, created_at) VALUES (?, ?, 'SESSION_REVOKED', 'WARNING', ?, ?, ?)").bind(crypto.randomUUID(), account.id, context.requestId, JSON.stringify({ revokeAll: true }), now),
      ]);
    } else {
      if (typeof body.sessionId !== "string" || !body.sessionId.trim()) throw new SecurityError("SESSION_ID_REQUIRED", 400);
      const results = await d1.batch([
        d1.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").bind(now, body.sessionId.trim(), account.id),
        d1.prepare("INSERT INTO security_events (id, user_id, event_type, severity, request_id, metadata, created_at) SELECT ?, ?, 'SESSION_REVOKED', 'WARNING', ?, ?, ? WHERE EXISTS (SELECT 1 FROM auth_sessions WHERE id = ? AND user_id = ? AND revoked_at = ?)")
          .bind(crypto.randomUUID(), account.id, context.requestId, JSON.stringify({ revokeAll: false, sessionId: body.sessionId.trim() }), now, body.sessionId.trim(), account.id, now),
      ]);
      if (!results[1]?.meta.changes) throw new SecurityError("SESSION_NOT_FOUND", 404);
    }
    return securityResponse({ ok: true, revokedAt: now }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
