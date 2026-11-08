import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { facilities, staffFacilityAssignments, staffProfiles, users } from "../../../../db/schema";
import { getRequestContext, getVisitorSessionIdentity, getWorkspaceIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const identity = await getWorkspaceIdentity();
    if (!identity) {
      const visitor = await getVisitorSessionIdentity();
      if (!visitor) return securityErrorResponse(new SecurityError("AUTHENTICATION_REQUIRED", 401), context.requestId);
      return securityResponse({ authenticated: true, provisioned: true, identity: { id: visitor.userId, email: visitor.email, phone: visitor.phone, phoneVerifiedAt: visitor.phoneVerifiedAt, displayName: visitor.displayName, userType: "VISITOR" }, scope: null }, 200, context.requestId);
    }
    const db = await getDb();
    const [user] = await db.select({ id: users.id, status: users.status, displayName: users.displayName, userType: users.userType }).from(users).where(and(eq(users.externalId, identity.externalId), eq(users.userType, "STAFF"))).limit(1);
    if (!user) return securityResponse({ authenticated: true, provisioned: false, identity: { email: identity.email, displayName: identity.displayName } }, 200, context.requestId);
    const assignments = await db.select({ facilityId: staffFacilityAssignments.facilityId, facilityName: facilities.name, jobTitle: staffFacilityAssignments.jobTitle, status: staffFacilityAssignments.status })
      .from(staffFacilityAssignments).innerJoin(facilities, eq(staffFacilityAssignments.facilityId, facilities.id))
      .where(eq(staffFacilityAssignments.userId, user.id));
    const legacyProfile = assignments.length ? null : await db.select({ facilityId: staffProfiles.facilityId, jobTitle: staffProfiles.jobTitle, facilityName: facilities.name })
      .from(staffProfiles).innerJoin(facilities, eq(staffProfiles.facilityId, facilities.id)).where(eq(staffProfiles.userId, user.id)).limit(1);
    const scopes = assignments.filter((assignment) => assignment.status === "ACTIVE").map((assignment) => ({ facilityId: assignment.facilityId, facilityName: assignment.facilityName, jobTitle: assignment.jobTitle }));
    const scope = scopes[0] || legacyProfile?.[0] || null;
    return securityResponse({ authenticated: true, provisioned: user.status === "ACTIVE", identity: { id: user.id, email: identity.email, displayName: user.displayName, userType: user.userType }, scope, scopes }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
