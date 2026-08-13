import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditEvents } from "../../../../db/schema";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("audit.read");
    const limitParam = Number(new URL(request.url).searchParams.get("limit") || "50");
    const limit = Math.min(Math.max(Number.isFinite(limitParam) ? Math.floor(limitParam) : 50, 1), 100);
    const db = await getDb();
    const events = await db.select().from(auditEvents).where(eq(auditEvents.facilityId, authorization.facilityId)).orderBy(desc(auditEvents.createdAt)).limit(limit);
    return securityResponse({ events, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
