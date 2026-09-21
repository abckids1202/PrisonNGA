import { getD1 } from "../../../../db/runtime";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const commands = ["set_status", "heartbeat"] as const;

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT r.id, r.resource_type, r.display_name, r.status, r.room_id, r.health_state, r.last_heartbeat_at, r.version,
      (SELECT rr.appointment_id FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.facility_id = r.facility_id AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.starts_at ASC LIMIT 1) AS active_appointment_id
      FROM resources r WHERE r.facility_id = ? ORDER BY r.resource_type, r.display_name`).bind(authorization.facilityId).all();
    return securityResponse({ resources: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.state.change");
    const body = await request.json() as { resourceId?: unknown; command?: unknown; status?: unknown; expectedVersion?: unknown; reason?: unknown };
    if (typeof body.resourceId !== "string" || !body.resourceId.trim() || !commands.includes(body.command as typeof commands[number])) throw new SecurityError("INVALID_RESOURCE_COMMAND", 400);
    const reason = assertReason(body.reason);
    const d1 = await getD1();
    const current = await d1.prepare("SELECT id, status, version FROM resources WHERE id = ? AND facility_id = ?").bind(body.resourceId.trim(), authorization.facilityId).first<{ id: string; status: string; version: number }>();
    if (!current) throw new SecurityError("RESOURCE_NOT_FOUND", 404);
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) throw new SecurityError("STALE_RESOURCE", 409);
    const now = new Date().toISOString();
    if (body.command === "heartbeat") {
      await d1.prepare("UPDATE resources SET last_heartbeat_at = ?, health_state = 'HEALTHY', version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?").bind(now, now, current.id, authorization.facilityId, current.version).run();
      return securityResponse({ resourceId: current.id, status: current.status, version: current.version + 1, reason }, 200, context.requestId);
    }
    if (typeof body.status !== "string" || !["AVAILABLE", "ONLINE", "OFFLINE", "MAINTENANCE"].includes(body.status)) throw new SecurityError("INVALID_RESOURCE_STATUS", 400);
    const result = await d1.prepare("UPDATE resources SET status = ?, health_state = CASE WHEN ? IN ('AVAILABLE', 'ONLINE') THEN 'HEALTHY' ELSE health_state END, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?").bind(body.status, body.status, now, current.id, authorization.facilityId, current.version).run();
    if (!result.meta.changes) throw new SecurityError("STALE_RESOURCE", 409);
    return securityResponse({ resourceId: current.id, status: body.status, version: current.version + 1, reason }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
