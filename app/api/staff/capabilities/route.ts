import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { facilities } from "../../../../db/schema";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const db = await getDb();
    const [facility] = await db.select({ id: facilities.id, name: facilities.name, timezone: facilities.timezone, currentState: facilities.currentState, version: facilities.version }).from(facilities).where(eq(facilities.id, authorization.facilityId)).limit(1);
    return securityResponse({ actor: { id: authorization.userId, displayName: authorization.displayName, roles: authorization.roles }, facility, permissions: authorization.permissions }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
