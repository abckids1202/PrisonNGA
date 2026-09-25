import { getD1 } from "../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../lib/server/events";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { createKioskCredentialSecret, hashKioskCredential } from "../../../../lib/server/kiosk-credentials";
import { resourceReassignmentStatements } from "../../../../lib/server/resource-reassignment";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";

const commands = ["set_status", "heartbeat", "issue_kiosk_credential", "revoke_kiosk_credential", "reassign_appointment"] as const;

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT r.id, r.resource_type, r.display_name, r.status, r.room_id, r.health_state, r.last_heartbeat_at, r.version,
      (SELECT rr.appointment_id FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.facility_id = r.facility_id AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.starts_at ASC LIMIT 1) AS active_appointment_id,
      (SELECT w.version FROM waiting_room_sessions w WHERE w.appointment_id = (SELECT rr.appointment_id FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.facility_id = r.facility_id AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.starts_at ASC LIMIT 1) AND w.facility_id = r.facility_id LIMIT 1) AS waiting_version,
      CASE WHEN EXISTS (SELECT 1 FROM kiosk_credentials kc WHERE kc.resource_id = r.id AND kc.facility_id = r.facility_id AND kc.status = 'ACTIVE') THEN 1 ELSE 0 END AS has_active_kiosk_credential,
      (SELECT kc.last_used_at FROM kiosk_credentials kc WHERE kc.resource_id = r.id AND kc.facility_id = r.facility_id AND kc.status = 'ACTIVE' LIMIT 1) AS kiosk_credential_last_used_at
      FROM resources r WHERE r.facility_id = ? ORDER BY r.resource_type, r.display_name`).bind(authorization.facilityId).all();
    return securityResponse({ resources: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let databaseRef: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const body = await request.json() as {
      resourceId?: unknown;
      command?: unknown;
      status?: unknown;
      expectedVersion?: unknown;
      reason?: unknown;
      appointmentId?: unknown;
      targetResourceId?: unknown;
      expectedTargetVersion?: unknown;
      expectedWaitingVersion?: unknown;
    };
    const authorization = await requirePermission(body.command === "reassign_appointment" ? "appointment.review" : "facility.state.change");
    if (typeof body.resourceId !== "string" || !body.resourceId.trim() || !commands.includes(body.command as typeof commands[number])) throw new SecurityError("INVALID_RESOURCE_COMMAND", 400);
    const reason = assertReason(body.reason);
    const d1 = await getD1();
    databaseRef = d1;
    const current = await d1.prepare("SELECT id, display_name, status, version FROM resources WHERE id = ? AND facility_id = ?").bind(body.resourceId.trim(), authorization.facilityId).first<{ id: string; display_name: string; status: string; version: number }>();
    if (!current) throw new SecurityError("RESOURCE_NOT_FOUND", 404);
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) throw new SecurityError("STALE_RESOURCE", 409);
    const now = new Date().toISOString();
    if (body.command === "reassign_appointment") {
      if (typeof body.appointmentId !== "string" || !body.appointmentId.trim() || typeof body.targetResourceId !== "string" || !body.targetResourceId.trim()) throw new SecurityError("INVALID_RESOURCE_REASSIGNMENT", 400);
      if (body.expectedVersion === undefined || body.expectedTargetVersion === undefined || body.expectedWaitingVersion === undefined) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);
      const expectedSourceVersion = Number(body.expectedVersion);
      const expectedTargetVersion = Number(body.expectedTargetVersion);
      const expectedWaitingVersion = Number(body.expectedWaitingVersion);
      if (![expectedSourceVersion, expectedTargetVersion, expectedWaitingVersion].every(Number.isSafeInteger)) throw new SecurityError("INVALID_RESOURCE_VERSION", 400);
      const appointmentId = body.appointmentId.trim();
      const targetResourceId = body.targetResourceId.trim();
      const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
      const scope = `resource-reassign:${authorization.facilityId}:${appointmentId}:${current.id}`;
      const requestHash = await hashIdempotencyPayload({
        resourceId: current.id,
        appointmentId,
        targetResourceId,
        command: body.command,
        expectedVersion: body.expectedVersion,
        expectedTargetVersion: body.expectedTargetVersion,
        expectedWaitingVersion: body.expectedWaitingVersion,
        reason,
      });
      const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
      if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
      idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
      const finish = async (responseBody: unknown, status = 200) => {
        const completed = await d1.batch([completeIdempotencyStatement(d1, { ...idempotency!, status, body: responseBody })]);
        if (!completed[0]?.meta.changes) throw new SecurityError("RESOURCE_REASSIGNMENT_IDEMPOTENCY_CONFLICT", 409);
        idempotency = null;
        return securityResponse(responseBody, status, context.requestId);
      };
      const source = await d1.prepare(`SELECT rr.id, rr.resource_type, rr.resource_id, rr.status, rr.starts_at, rr.ends_at,
        a.status AS appointment_status, a.version AS appointment_version,
        w.version AS waiting_version, w.assigned_room_id, w.assigned_kiosk_id
        FROM resource_reservations rr
        INNER JOIN appointments a ON a.id = rr.appointment_id AND a.facility_id = rr.facility_id
        LEFT JOIN waiting_room_sessions w ON w.appointment_id = a.id AND w.facility_id = a.facility_id
        WHERE rr.facility_id = ? AND rr.appointment_id = ? AND rr.resource_id = ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')
        LIMIT 1`).bind(authorization.facilityId, appointmentId, current.id).first<{
          id: string; resource_type: "ROOM" | "DEVICE"; resource_id: string; status: "HELD" | "RESERVED" | "ACTIVE";
          starts_at: string; ends_at: string; appointment_status: string; appointment_version: number;
          waiting_version: number | null; assigned_room_id: string | null; assigned_kiosk_id: string | null;
        }>();
      if (!source) throw new SecurityError("RESOURCE_ASSIGNMENT_NOT_FOUND", 404);
      if (!["APPROVED", "WAITING"].includes(source.appointment_status)) throw new SecurityError("RESOURCE_REASSIGNMENT_NOT_ALLOWED", 409);
      if (source.waiting_version !== null && source.waiting_version !== expectedWaitingVersion) throw new SecurityError("STALE_WAITING_ROOM", 409);
      if (source.waiting_version === null && expectedWaitingVersion !== 0) throw new SecurityError("WAITING_ROOM_NOT_INITIALIZED", 409);
      const assignedId = source.resource_type === "ROOM" ? source.assigned_room_id : source.assigned_kiosk_id;
      if (assignedId !== null && assignedId !== source.resource_id) throw new SecurityError("WAITING_ROOM_ASSIGNMENT_MISMATCH", 409);
      const target = await d1.prepare(`SELECT id, resource_type, display_name, status, health_state, version
        FROM resources WHERE id = ? AND facility_id = ?`).bind(targetResourceId, authorization.facilityId).first<{
          id: string; resource_type: "ROOM" | "DEVICE"; display_name: string; status: string; health_state: string; version: number;
        }>();
      if (!target) throw new SecurityError("TARGET_RESOURCE_NOT_FOUND", 404);
      if (target.resource_type !== source.resource_type) throw new SecurityError("RESOURCE_TYPE_MISMATCH", 409);
      if (target.status !== (target.resource_type === "ROOM" ? "AVAILABLE" : "ONLINE") || target.health_state !== "HEALTHY") throw new SecurityError("TARGET_RESOURCE_UNUSABLE", 409);
      if (target.version !== expectedTargetVersion) throw new SecurityError("STALE_TARGET_RESOURCE", 409);
      if (target.id === source.resource_id) throw new SecurityError("TARGET_RESOURCE_MUST_DIFFER", 400);

      const existingTarget = await d1.prepare(`SELECT id FROM resource_reservations
        WHERE facility_id = ? AND appointment_id = ? AND resource_type = ? AND resource_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE')`)
        .bind(authorization.facilityId, appointmentId, source.resource_type, target.id).first<{ id: string }>();
      if (existingTarget) {
        return finish({ appointmentId, resourceId: target.id, resourceType: target.resource_type, displayName: target.display_name, idempotent: true, waitingVersion: expectedWaitingVersion });
      }
      if (body.expectedVersion !== current.version) throw new SecurityError("STALE_RESOURCE", 409);
      const correlationId = crypto.randomUUID();
      const statements = resourceReassignmentStatements({ d1, facilityId: authorization.facilityId, appointmentId, sourceReservationId: source.id, sourceResourceId: source.resource_id, sourceResourceType: source.resource_type, sourceStatus: source.status, startsAt: source.starts_at, endsAt: source.ends_at, targetResourceId: target.id, expectedSourceVersion, expectedTargetVersion, expectedWaitingVersion, waitingExists: source.waiting_version !== null, actorUserId: authorization.userId, actorRole: authorization.roles[0] || null, reason, oldResourceName: current.display_name, newResourceName: target.display_name, requestId: context.requestId, correlationId, now });
      const results = await d1.batch(statements);
      const waitingUpdated = source.waiting_version === null || Boolean(results[4]?.meta.changes);
      if (!(results[0]?.meta.changes && results[1]?.meta.changes && results[2]?.meta.changes && results[3]?.meta.changes && waitingUpdated)) throw new SecurityError("RESOURCE_REASSIGNMENT_CONFLICT", 409);
      return finish({ appointmentId, resourceId: target.id, resourceType: target.resource_type, displayName: target.display_name, version: target.version + 1, waitingVersion: source.waiting_version === null ? null : expectedWaitingVersion + 1, correlationId });
    }
    if (body.command === "issue_kiosk_credential") {
      const device = await d1.prepare("SELECT id, resource_type FROM resources WHERE id = ? AND facility_id = ?").bind(current.id, authorization.facilityId).first<{ id: string; resource_type: string }>();
      if (device?.resource_type !== "DEVICE") throw new SecurityError("KIOSK_DEVICE_REQUIRED", 409);
      if (body.expectedVersion === undefined) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);
      await requireStepUp({ purpose: "kiosk_credential_issue", userId: authorization.userId, targetId: current.id, payload: { command: body.command, resourceId: current.id, expectedVersion: current.version, reason } });
      const secret = createKioskCredentialSecret();
      const credentialId = crypto.randomUUID();
      const credentialHash = await hashKioskCredential(secret);
      const correlationId = crypto.randomUUID();
      const resourceGuard = { sql: "EXISTS (SELECT 1 FROM resources WHERE id = ? AND facility_id = ? AND resource_type = 'DEVICE' AND version = ?)", values: [current.id, authorization.facilityId, current.version + 1] };
      const results = await d1.batch([
        d1.prepare("UPDATE resources SET version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND resource_type = 'DEVICE' AND version = ?").bind(now, current.id, authorization.facilityId, current.version),
        d1.prepare("UPDATE kiosk_credentials SET status = 'REVOKED', revoked_at = ? WHERE resource_id = ? AND facility_id = ? AND status = 'ACTIVE' AND EXISTS (SELECT 1 FROM resources WHERE id = ? AND facility_id = ? AND version = ?)").bind(now, current.id, authorization.facilityId, current.id, authorization.facilityId, current.version + 1),
        d1.prepare("INSERT INTO kiosk_credentials (id, facility_id, resource_id, credential_hash, status, created_by, created_at) SELECT ?, ?, ?, ?, 'ACTIVE', ?, ? WHERE EXISTS (SELECT 1 FROM resources WHERE id = ? AND facility_id = ? AND version = ?)").bind(credentialId, authorization.facilityId, current.id, credentialHash, authorization.userId, now, current.id, authorization.facilityId, current.version + 1),
        ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || null, facilityId: authorization.facilityId, actionType: "KIOSK_CREDENTIAL_ISSUED", entityType: "resource", entityId: current.id, reason, oldValues: { credentialStatus: "previous credential revoked" }, newValues: { credentialStatus: "ACTIVE", credentialId }, requestId: context.requestId, correlationId, eventType: "KIOSK_CREDENTIAL_ISSUED", payload: { resourceId: current.id, credentialId } }, resourceGuard),
      ]);
      if (!(results[0]?.meta.changes && results[2]?.meta.changes && results[3]?.meta.changes && results[4]?.meta.changes)) throw new SecurityError("STALE_RESOURCE", 409);
      return securityResponse({ resourceId: current.id, credential: { token: secret, header: "X-SecureVisit-Kiosk-Token" }, version: current.version + 1, oneTimeDisplay: true, correlationId }, 201, context.requestId);
    }
    if (body.command === "revoke_kiosk_credential") {
      const device = await d1.prepare("SELECT id, resource_type FROM resources WHERE id = ? AND facility_id = ?").bind(current.id, authorization.facilityId).first<{ id: string; resource_type: string }>();
      if (device?.resource_type !== "DEVICE") throw new SecurityError("KIOSK_DEVICE_REQUIRED", 409);
      if (body.expectedVersion === undefined) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);
      const activeCredential = await d1.prepare("SELECT id FROM kiosk_credentials WHERE resource_id = ? AND facility_id = ? AND status = 'ACTIVE'").bind(current.id, authorization.facilityId).first<{ id: string }>();
      if (!activeCredential) throw new SecurityError("KIOSK_CREDENTIAL_NOT_ACTIVE", 409);
      await requireStepUp({ purpose: "kiosk_credential_revoke", userId: authorization.userId, targetId: current.id, payload: { command: body.command, resourceId: current.id, expectedVersion: current.version, reason } });
      const correlationId = crypto.randomUUID();
      const resourceGuard = { sql: "EXISTS (SELECT 1 FROM resources WHERE id = ? AND facility_id = ? AND resource_type = 'DEVICE' AND version = ?)", values: [current.id, authorization.facilityId, current.version + 1] };
      const results = await d1.batch([
        d1.prepare("UPDATE resources SET version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND resource_type = 'DEVICE' AND version = ?").bind(now, current.id, authorization.facilityId, current.version),
        d1.prepare("UPDATE kiosk_credentials SET status = 'REVOKED', revoked_at = ? WHERE id = ? AND resource_id = ? AND facility_id = ? AND status = 'ACTIVE' AND EXISTS (SELECT 1 FROM resources WHERE id = ? AND facility_id = ? AND version = ?)").bind(now, activeCredential.id, current.id, authorization.facilityId, current.id, authorization.facilityId, current.version + 1),
        ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || null, facilityId: authorization.facilityId, actionType: "KIOSK_CREDENTIAL_REVOKED", entityType: "resource", entityId: current.id, reason, oldValues: { credentialStatus: "ACTIVE", credentialId: activeCredential.id }, newValues: { credentialStatus: "REVOKED" }, requestId: context.requestId, correlationId, eventType: "KIOSK_CREDENTIAL_REVOKED", payload: { resourceId: current.id, credentialId: activeCredential.id } }, resourceGuard),
      ]);
      if (!(results[0]?.meta.changes && results[1]?.meta.changes && results[2]?.meta.changes && results[3]?.meta.changes)) throw new SecurityError("STALE_RESOURCE", 409);
      return securityResponse({ resourceId: current.id, credentialStatus: "REVOKED", version: current.version + 1, correlationId }, 200, context.requestId);
    }
    if (body.command === "heartbeat") {
      const heartbeat = await d1.prepare("UPDATE resources SET last_heartbeat_at = ?, health_state = 'HEALTHY', version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?").bind(now, now, current.id, authorization.facilityId, current.version).run();
      if (!heartbeat.meta.changes) throw new SecurityError("STALE_RESOURCE", 409);
      return securityResponse({ resourceId: current.id, status: current.status, version: current.version + 1, reason }, 200, context.requestId);
    }
    if (body.command !== "set_status") throw new SecurityError("INVALID_RESOURCE_COMMAND", 400);
    if (typeof body.status !== "string" || !["AVAILABLE", "ONLINE", "OFFLINE", "MAINTENANCE"].includes(body.status)) throw new SecurityError("INVALID_RESOURCE_STATUS", 400);
    if (body.expectedVersion === undefined) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);
    const nextStatus = body.status;
    const correlationId = crypto.randomUUID();
    const resourceGuard = { sql: "EXISTS (SELECT 1 FROM resources WHERE id = ? AND facility_id = ? AND version = ? AND status = ?)", values: [current.id, authorization.facilityId, current.version + 1, nextStatus] };
    const results = await d1.batch([
      d1.prepare("UPDATE resources SET status = ?, health_state = CASE WHEN ? IN ('AVAILABLE', 'ONLINE') THEN 'HEALTHY' ELSE health_state END, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?").bind(nextStatus, nextStatus, now, current.id, authorization.facilityId, current.version),
      ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || null, facilityId: authorization.facilityId, actionType: "RESOURCE_STATUS_CHANGED", entityType: "resource", entityId: current.id, reason, oldValues: { status: current.status, version: current.version }, newValues: { status: nextStatus, version: current.version + 1 }, requestId: context.requestId, correlationId, eventType: "RESOURCE_STATUS_CHANGED", payload: { resourceId: current.id, status: nextStatus } }, resourceGuard),
    ]);
    if (!(results[0]?.meta.changes && results[1]?.meta.changes && results[2]?.meta.changes)) throw new SecurityError("STALE_RESOURCE", 409);
    return securityResponse({ resourceId: current.id, status: nextStatus, version: current.version + 1, correlationId, reason }, 200, context.requestId);
  } catch (error) {
    if (databaseRef && idempotency) {
      try { await releaseIdempotencyClaim(databaseRef, idempotency); } catch { /* Preserve the original resource error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
