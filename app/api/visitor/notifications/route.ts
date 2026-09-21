import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const result = await d1.prepare("SELECT id, channel, template, title, body, payload, status, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").bind(visitor.userId).all();
    return securityResponse({ notifications: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PATCH(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { notificationIds?: unknown[] };
    const ids = Array.isArray(body.notificationIds) ? body.notificationIds.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9-]{10,80}$/.test(id)).slice(0, 50) : [];
    if (!ids.length) throw new SecurityError("NOTIFICATION_IDS_REQUIRED", 400);
    const now = new Date().toISOString();
    const d1 = await getD1();
    await d1.batch(ids.map((id) => d1.prepare("UPDATE notifications SET status = 'READ', read_at = ? WHERE id = ? AND user_id = ? AND status != 'READ'").bind(now, id, visitor.userId)));
    return securityResponse({ ok: true, markedRead: ids.length }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
