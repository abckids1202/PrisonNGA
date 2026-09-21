import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../../../../db";
import { authSessions, securityEvents, users } from "../../../../db/schema";
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
    const db = await getDb();
    const now = new Date().toISOString();
    if (body.revokeAll === true) {
      await db.update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.userId, account.id), isNull(authSessions.revokedAt)));
    } else {
      if (typeof body.sessionId !== "string" || !body.sessionId.trim()) throw new SecurityError("SESSION_ID_REQUIRED", 400);
      const result = await db.update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.id, body.sessionId.trim()), eq(authSessions.userId, account.id), isNull(authSessions.revokedAt)));
      if (!result.rowsAffected) throw new SecurityError("SESSION_NOT_FOUND", 404);
    }
    await db.insert(securityEvents).values({ id: crypto.randomUUID(), userId: account.id, eventType: "SESSION_REVOKED", severity: "WARNING", requestId: context.requestId, metadata: { revokeAll: body.revokeAll === true } });
    return securityResponse({ ok: true, revokedAt: now }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
