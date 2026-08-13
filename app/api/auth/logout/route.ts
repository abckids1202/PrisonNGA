import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { securityEvents, users } from "../../../../db/schema";
import { getRequestContext, getSecuritySalt, getWorkspaceIdentity, hashIdentifier, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function POST() {
  const context = await getRequestContext();
  try {
    const identity = await getWorkspaceIdentity();
    if (!identity) return securityErrorResponse(new SecurityError("AUTHENTICATION_REQUIRED", 401), context.requestId);
    const db = await getDb();
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.externalId, identity.externalId)).limit(1);
    if (user) {
      const salt = await getSecuritySalt();
      await db.insert(securityEvents).values({ id: crypto.randomUUID(), userId: user.id, eventType: "LOGOUT_REQUESTED", severity: "INFO", requestId: context.requestId, ipHash: context.ipAddress ? await hashIdentifier(context.ipAddress, salt) : null, userAgentHash: context.userAgent ? await hashIdentifier(context.userAgent, salt) : null, metadata: { provider: "workspace-auth" } });
    }
    return securityResponse({ ok: true, signOutPath: "/signout-with-chatgpt?return_to=/" }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
