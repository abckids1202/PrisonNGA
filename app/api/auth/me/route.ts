import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { facilities, staffProfiles, users } from "../../../../db/schema";
import { getRequestContext, getWorkspaceIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const identity = await getWorkspaceIdentity();
    if (!identity) return securityErrorResponse(new SecurityError("AUTHENTICATION_REQUIRED", 401), context.requestId);
    const db = await getDb();
    const [user] = await db.select({ id: users.id, status: users.status, displayName: users.displayName, userType: users.userType }).from(users).where(eq(users.externalId, identity.externalId)).limit(1);
    if (!user) return securityResponse({ authenticated: true, provisioned: false, identity: { email: identity.email, displayName: identity.displayName } }, 200, context.requestId);
    const [profile] = await db.select({ facilityId: staffProfiles.facilityId, jobTitle: staffProfiles.jobTitle, facilityName: facilities.name }).from(staffProfiles).innerJoin(facilities, eq(staffProfiles.facilityId, facilities.id)).where(eq(staffProfiles.userId, user.id)).limit(1);
    return securityResponse({ authenticated: true, provisioned: user.status === "ACTIVE", identity: { id: user.id, email: identity.email, displayName: user.displayName, userType: user.userType }, scope: profile ? { facilityId: profile.facilityId, facilityName: profile.facilityName, jobTitle: profile.jobTitle } : null }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
