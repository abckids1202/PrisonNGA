import { getD1 } from "../../../../db/runtime";
import { createIncidentStatements, transitionIncidentStatements } from "../../../../lib/server/incident-workflow";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, getSecuritySalt, hashIdentifier, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

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
  let database: D1Database | null = null;
  let transitionClaim: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("incident.manage");
    const body = await request.json() as { incidentId?: unknown; command?: unknown; title?: unknown; description?: unknown; incidentType?: unknown; severity?: unknown; appointmentId?: unknown; sessionId?: unknown; resourceId?: unknown; assignedUserId?: unknown; resolution?: unknown; expectedVersion?: unknown; reason?: unknown };
    const command = body.command as typeof commands[number] | undefined;
    const d1 = await getD1();
    database = d1;
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    if (!body.incidentId) {
      if (typeof body.title !== "string" || body.title.trim().length < 4 || typeof body.description !== "string" || body.description.trim().length < 8) throw new SecurityError("INCIDENT_DETAILS_REQUIRED", 400);
      if (typeof body.severity !== "string" || !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(body.severity)) throw new SecurityError("INVALID_INCIDENT_SEVERITY", 400);
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
      if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
      const incidentType = typeof body.incidentType === "string" ? body.incidentType.trim().slice(0, 60) : "OPERATIONAL";
      const title = body.title.trim().slice(0, 160);
      const description = body.description.trim().slice(0, 2000);
      const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId.trim() : null;
      const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : null;
      const resourceId = typeof body.resourceId === "string" ? body.resourceId.trim() : null;
      const salt = await getSecuritySalt();
      const idempotencyKeyHash = await hashIdentifier(`incident-create:${authorization.facilityId}:${authorization.userId}:${idempotencyKey}`, salt);
      const requestHash = await hashIdentifier(JSON.stringify({ incidentType, severity: body.severity, title, description, appointmentId, sessionId, resourceId }), salt);
      const id = `INC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const event = { actorUserId: authorization.userId, actorRole: authorization.roles[0] || null, facilityId: authorization.facilityId, actionType: "INCIDENT_CREATED", entityType: "incident", entityId: id, reason: description, newValues: { incidentType, severity: body.severity, title, appointmentId, sessionId, resourceId }, requestId: context.requestId, correlationId, eventType: "INCIDENT_CREATED", payload: { incidentId: id, severity: body.severity } };
      const results = await d1.batch(createIncidentStatements(d1, { id, facilityId: authorization.facilityId, incidentType, severity: String(body.severity), title, description, appointmentId, sessionId, resourceId, reporterUserId: authorization.userId, idempotencyKey: idempotencyKeyHash, requestHash, now, correlationId }, event));
      if (!results[0]?.meta.changes) {
        const existing = await d1.prepare("SELECT id, status, version, request_hash FROM incidents WHERE facility_id = ? AND reporter_user_id = ? AND idempotency_key = ?").bind(authorization.facilityId, authorization.userId, idempotencyKeyHash).first<{ id: string; status: string; version: number; request_hash: string }>();
        if (!existing) throw new SecurityError("INCIDENT_CREATE_CONFLICT", 409);
        if (existing.request_hash !== requestHash) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
        return securityResponse({ incidentId: existing.id, status: existing.status, version: existing.version, idempotent: true }, 200, context.requestId);
      }
      return securityResponse({ incidentId: id, status: "OPEN", version: 1, correlationId }, 201, context.requestId);
    }
    if (!command || !commands.includes(command)) throw new SecurityError("INVALID_INCIDENT_COMMAND", 400);
    const incident = await d1.prepare("SELECT id, status, version, assigned_user_id FROM incidents WHERE id = ? AND facility_id = ?").bind(String(body.incidentId).trim(), authorization.facilityId).first<{ id: string; status: string; version: number; assigned_user_id: string | null }>();
    if (!incident) throw new SecurityError("INCIDENT_NOT_FOUND", 404);
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);
    const reason = assertReason(body.reason);
    const nextStatus = command === "acknowledge" ? "ACKNOWLEDGED" : command === "resolve" ? "RESOLVED" : command === "close" ? "CLOSED" : incident.status;
    const nextAssignee = command === "assign" ? (typeof body.assignedUserId === "string" && body.assignedUserId.trim() ? body.assignedUserId.trim() : null) : incident.assigned_user_id;
    if (command === "assign" && !nextAssignee) throw new SecurityError("ASSIGNEE_REQUIRED", 400);
    const resolution = command === "resolve" ? (typeof body.resolution === "string" && body.resolution.trim().length >= 8 ? body.resolution.trim().slice(0, 2000) : "") : null;
    if (command === "resolve" && !resolution) throw new SecurityError("INCIDENT_RESOLUTION_REQUIRED", 400);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const idempotencyScope = `incident-transition:${authorization.facilityId}:${authorization.userId}:${incident.id}`;
    const requestHash = await hashIdempotencyPayload({ incidentId: incident.id, command, expectedVersion: Number(body.expectedVersion), assignedUserId: nextAssignee, resolution, details: command === "resolve" ? resolution : reason });
    const claim = await claimIdempotency(d1, { scope: idempotencyScope, key: idempotencyKey, requestHash });
    if ("replay" in claim) return securityResponse(claim.replay.body, claim.replay.status, context.requestId);
    transitionClaim = { claimId: claim.claimId, scope: idempotencyScope, key: idempotencyKey };
    if (Number(body.expectedVersion) !== incident.version) throw new SecurityError("STALE_INCIDENT", 409);
    if (command === "close") await requireStepUp({ purpose: "incident_close", userId: authorization.userId, targetId: incident.id, payload: { incidentId: incident.id, command, expectedVersion: incident.version, reason, resolution: body.resolution ?? null } });
    if (command === "close" && incident.status !== "RESOLVED") throw new SecurityError("INCIDENT_MUST_BE_RESOLVED", 409);
    if (command === "acknowledge" && incident.status !== "OPEN") throw new SecurityError("INCIDENT_NOT_ACKNOWLEDGEABLE", 409);
    if (command === "resolve" && !["OPEN", "ACKNOWLEDGED"].includes(incident.status)) throw new SecurityError("INCIDENT_NOT_RESOLVABLE", 409);
    if (command === "assign" && incident.status === "CLOSED") throw new SecurityError("INCIDENT_CLOSED", 409);
    if (command === "assign" && nextAssignee) {
      const assignee = await d1.prepare("SELECT 1 AS active FROM users u INNER JOIN staff_profiles sp ON sp.user_id = u.id WHERE u.id = ? AND sp.facility_id = ? AND u.user_type = 'STAFF' AND u.status = 'ACTIVE'").bind(nextAssignee, authorization.facilityId).first();
      if (!assignee) throw new SecurityError("INCIDENT_ASSIGNEE_NOT_FOUND", 404);
    }
    const event = { actorUserId: authorization.userId, actorRole: authorization.roles[0] || null, facilityId: authorization.facilityId, actionType: `INCIDENT_${command.toUpperCase()}`, entityType: "incident", entityId: incident.id, reason: command === "resolve" ? resolution : reason, oldValues: { status: incident.status, assignedUserId: incident.assigned_user_id, version: incident.version }, newValues: { status: nextStatus, assignedUserId: nextAssignee, resolution, version: incident.version + 1 }, requestId: context.requestId, correlationId, eventType: `INCIDENT_${command.toUpperCase()}`, payload: { incidentId: incident.id, command } };
    const details: string = command === "resolve" ? (resolution || "") : reason;
    if (!details) throw new SecurityError("INCIDENT_DETAILS_REQUIRED", 400);
    const responseBody = { incidentId: incident.id, status: nextStatus, assignedUserId: nextAssignee, version: incident.version + 1, correlationId };
    const results = await d1.batch([
      ...transitionIncidentStatements(d1, { incidentId: incident.id, facilityId: authorization.facilityId, expectedVersion: incident.version, nextStatus, nextAssignee, resolution, actorUserId: authorization.userId, command, details, now, correlationId }, event),
      completeIdempotencyStatement(d1, { ...transitionClaim, status: 200, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM incidents WHERE id = ? AND facility_id = ? AND version = ?)", values: [incident.id, authorization.facilityId, incident.version + 1] } }),
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("STALE_INCIDENT", 409);
    transitionClaim = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (database && transitionClaim) await releaseIdempotencyClaim(database, transitionClaim).catch(() => undefined);
    return securityErrorResponse(error, context.requestId);
  }
}
