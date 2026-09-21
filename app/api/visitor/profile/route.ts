import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { visitorProfiles } from "../../../../db/schema";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const db = await getDb();
    const [profile] = await db.select().from(visitorProfiles).where(eq(visitorProfiles.userId, visitor.userId)).limit(1);
    return securityResponse({ profile: profile || { userId: visitor.userId, legalName: visitor.displayName, preferredName: null, phone: null, phoneVerifiedAt: null, profileStatus: "INCOMPLETE" } }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PUT(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { legalName?: unknown; preferredName?: unknown; phone?: unknown };
    const legalName = typeof body.legalName === "string" ? body.legalName.trim().slice(0, 160) : "";
    const preferredName = typeof body.preferredName === "string" ? body.preferredName.trim().slice(0, 120) : null;
    const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : null;
    if (legalName.length < 2) throw new SecurityError("LEGAL_NAME_REQUIRED", 400);
    const db = await getDb();
    await db.insert(visitorProfiles).values({ userId: visitor.userId, legalName, preferredName, phone, profileStatus: "INCOMPLETE", version: 1 }).onConflictDoUpdate({ target: visitorProfiles.userId, set: { legalName, preferredName, phone, updatedAt: new Date().toISOString(), version: 1 } });
    const [profile] = await db.select().from(visitorProfiles).where(eq(visitorProfiles.userId, visitor.userId)).limit(1);
    return securityResponse({ profile }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
