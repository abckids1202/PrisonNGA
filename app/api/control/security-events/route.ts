import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { securityEvents } from "../../../../db/schema";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("audit.read");
    const db = await getDb();
    const events = await db.select().from(securityEvents).where(eq(securityEvents.facilityId, authorization.facilityId)).orderBy(desc(securityEvents.createdAt)).limit(100);
    return securityResponse({ events, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
