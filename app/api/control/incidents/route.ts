import { getD1 } from "../../../../db/runtime";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const commands = ["acknowledge", "assign", "add_note", "resolve", "close"] as const;

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("incident.read");
    const status = new URL(request.url).searchParams.get("status")?.trim();
    const d1 = await getD1();
    const result = status
      ? await d1.prepare(`SELECT i.*, reporter.display_name AS reporter_name, assignee.display_name AS assignee_name FROM incidents i INNER JOIN users reporter ON reporter.id = i.reporter_user_id LEFT JOIN users assignee ON assignee.id = i.assigned_user_id WHERE i.facility_id = ? AND i.status = ? ORDER BY i.created_at DESC`).bind(authorization.facilityId, status).all()
      : await d1.prepare(`SELECT i.*, reporter.display_name AS reporter_name, assignee.display_name AS assignee_name FROM incidents i INNER JOIN users reporter ON reporter.id = i.reporter_user_id LEFT JOIN users assignee ON assignee.id = i.assigned_user_id WHERE i.facility_id = ? ORDER BY i.created_at DESC`).bind(authorization.facilityId).all();
    return securityResponse({ incidents: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("incident.manage");
    const body = await request.json() as { incidentId?: unknown; command?: unknown; title?: unknown; description?: unknown; incidentType?: unknown; severity?: unknown; appointmentId?: unknown; sessionId?: unknown; resourceId?: unknown; assignedUserId?: unknown; resolution?: unknown; expectedVersion?: unknown; reason?: unknown };
    const command = body.command as typeof commands[number] | undefined;
    const d1 = await getD1();
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    if (!body.incidentId) {
      if (typeof body.title !== "string" || body.title.trim().length < 4 || typeof body.description !== "string" || body.description.trim().length < 8) throw new SecurityError("INCIDENT_DETAILS_REQUIRED", 400);
      if (typeof body.severity !== "string" || !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(body.severity)) throw new SecurityError("INVALID_INCIDENT_SEVERITY", 400);
      const id = `INC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      await d1.batch([
        d1.prepare(`INSERT INTO incidents (id, facility_id, incident_type, severity, status, title, description, appointment_id, session_id, resource_id, reporter_user_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(id, authorization.facilityId, typeof body.incidentType === "string" ? body.incidentType.trim().slice(0, 60) : "OPERATIONAL", body.severity, body.title.trim().slice(0, 160), body.description.trim().slice(0, 2000), typeof body.appointmentId === "string" ? body.appointmentId.trim() : null, typeof body.sessionId === "string" ? body.sessionId.trim() : null, typeof body.resourceId === "string" ? body.resourceId.trim() : null, authorization.userId, now, now),
        d1.prepare(`INSERT INTO incident_events (id, incident_id, event_type, actor_user_id, details, correlation_id, created_at) VALUES (?, ?, 'CREATED', ?, ?, ?, ?)`).bind(crypto.randomUUID(), id, authorization.userId, body.description.trim().slice(0, 2000), correlationId, now),
      ]);
      return securityResponse({ incidentId: id, status: "OPEN", version: 1, correlationId }, 201, context.requestId);
    }
    if (!command || !commands.includes(command)) throw new SecurityError("INVALID_INCIDENT_COMMAND", 400);
    const incident = await d1.prepare("SELECT id, status, version, assigned_user_id FROM incidents WHERE id = ? AND facility_id = ?").bind(String(body.incidentId).trim(), authorization.facilityId).first<{ id: string; status: string; version: number; assigned_user_id: string | null }>();
    if (!incident) throw new SecurityError("INCIDENT_NOT_FOUND", 404);
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== incident.version) throw new SecurityError("STALE_INCIDENT", 409);
    const reason = assertReason(body.reason);
    const nextStatus = command === "acknowledge" ? "ACKNOWLEDGED" : command === "resolve" ? "RESOLVED" : command === "close" ? "CLOSED" : incident.status;
    if (command === "close" && incident.status !== "RESOLVED") throw new SecurityError("INCIDENT_MUST_BE_RESOLVED", 409);
    const nextAssignee = command === "assign" ? (typeof body.assignedUserId === "string" && body.assignedUserId.trim() ? body.assignedUserId.trim() : null) : incident.assigned_user_id;
    if (command === "assign" && !nextAssignee) throw new SecurityError("ASSIGNEE_REQUIRED", 400);
    const resolution = command === "resolve" ? (typeof body.resolution === "string" && body.resolution.trim().length >= 8 ? body.resolution.trim().slice(0, 2000) : reason) : null;
    await d1.batch([
      d1.prepare("UPDATE incidents SET status = ?, assigned_user_id = ?, resolution = COALESCE(?, resolution), version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?").bind(nextStatus, nextAssignee, resolution, now, incident.id, authorization.facilityId, incident.version),
      d1.prepare("INSERT INTO incident_events (id, incident_id, event_type, actor_user_id, details, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), incident.id, command.toUpperCase(), authorization.userId, command === "add_note" ? reason : resolution || reason, correlationId, now),
    ]);
    return securityResponse({ incidentId: incident.id, status: nextStatus, assignedUserId: nextAssignee, version: incident.version + 1, correlationId }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
