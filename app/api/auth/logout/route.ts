import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../../../../db";
import { authSessions, securityEvents, users } from "../../../../db/schema";
import { getRequestContext, getRuntimeValue, getSecuritySalt, getWorkspaceIdentity, hashIdentifier, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function POST() {
  const context = await getRequestContext();
  try {
    const identity = await getWorkspaceIdentity();
    const sessionToken = (await cookies()).get("securevisit_session")?.value;
    const staffSessionToken = (await cookies()).get("securevisit_staff_session")?.value;
    if (!identity && !sessionToken && !staffSessionToken) return securityErrorResponse(new SecurityError("AUTHENTICATION_REQUIRED", 401), context.requestId);
    const db = await getDb();
    const salt = await getSecuritySalt();
    let user: { id: string } | undefined;
    let shouldAuditLogout = Boolean(identity);
    if (identity) [user] = await db.select({ id: users.id }).from(users).where(eq(users.externalId, identity.externalId)).limit(1);
    if (sessionToken) {
      const tokenHash = await hashIdentifier(sessionToken, salt);
      const [sessionUser] = await db.select({ id: users.id, revokedAt: authSessions.revokedAt }).from(authSessions).innerJoin(users, eq(authSessions.userId, users.id)).where(eq(authSessions.tokenHash, tokenHash)).limit(1);
      if (!user) user = sessionUser;
      if (sessionUser && !sessionUser.revokedAt) shouldAuditLogout = true;
      await db.update(authSessions).set({ revokedAt: new Date().toISOString() }).where(eq(authSessions.tokenHash, tokenHash));
    }
    if (staffSessionToken) {
      const tokenHash = await hashIdentifier(staffSessionToken, salt);
      const [sessionUser] = await db.select({ id: users.id, revokedAt: authSessions.revokedAt }).from(authSessions).innerJoin(users, eq(authSessions.userId, users.id)).where(eq(authSessions.tokenHash, tokenHash)).limit(1);
      if (!user) user = sessionUser;
      if (sessionUser && !sessionUser.revokedAt) shouldAuditLogout = true;
      await db.update(authSessions).set({ revokedAt: new Date().toISOString() }).where(eq(authSessions.tokenHash, tokenHash));
    }
    if (user && shouldAuditLogout) {
      await db.insert(securityEvents).values({ id: crypto.randomUUID(), userId: user.id, eventType: "LOGOUT_REQUESTED", severity: "INFO", requestId: context.requestId, ipHash: context.ipAddress ? await hashIdentifier(context.ipAddress, salt) : null, userAgentHash: context.userAgent ? await hashIdentifier(context.userAgent, salt) : null, metadata: { provider: "workspace-auth" } });
    }
    const response = securityResponse({ ok: true, signOutPath: identity && !staffSessionToken ? "/signout-with-chatgpt?return_to=/" : null }, 200, context.requestId);
    const secureCookie = (await getRuntimeValue("SECUREVISIT_ENVIRONMENT")) !== "development" ? "; Secure" : "";
    if (sessionToken) response.headers.set("Set-Cookie", `securevisit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`);
    if (staffSessionToken) response.headers.append("Set-Cookie", `securevisit_staff_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`);
    return response;
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
