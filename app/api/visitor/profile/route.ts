import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { visitorProfiles } from "../../../../db/schema";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { parseVisitorProfileInput } from "../../../../lib/server/visitor-profile";

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const db = await getDb();
    const [profile] = await db.select().from(visitorProfiles).where(eq(visitorProfiles.userId, visitor.userId)).limit(1);
    return securityResponse({ profile: profile || { userId: visitor.userId, legalName: visitor.displayName, preferredName: null, phone: visitor.phone, phoneVerifiedAt: visitor.phone ? new Date().toISOString() : null, profileStatus: "INCOMPLETE" } }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PUT(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { legalName?: unknown; preferredName?: unknown; phone?: unknown };
    const { legalName, preferredName, phone } = parseVisitorProfileInput(body);
    const db = await getDb();
    const [current] = await db.select({ profileStatus: visitorProfiles.profileStatus, phone: visitorProfiles.phone, phoneVerifiedAt: visitorProfiles.phoneVerifiedAt }).from(visitorProfiles).where(eq(visitorProfiles.userId, visitor.userId)).limit(1);
    if (current?.profileStatus === "SUSPENDED") throw new SecurityError("PROFILE_SUSPENDED", 403);
    const now = new Date().toISOString();
    await db.insert(visitorProfiles).values({ userId: visitor.userId, legalName, preferredName, phone, phoneVerifiedAt: null, profileStatus: "ACTIVE", version: 1 }).onConflictDoUpdate({ target: visitorProfiles.userId, set: { legalName, preferredName, phone, phoneVerifiedAt: current?.phone === phone ? current.phoneVerifiedAt : null, profileStatus: "ACTIVE", updatedAt: now, version: sql`${visitorProfiles.version} + 1` } });
    const [profile] = await db.select().from(visitorProfiles).where(eq(visitorProfiles.userId, visitor.userId)).limit(1);
    return securityResponse({ profile }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
