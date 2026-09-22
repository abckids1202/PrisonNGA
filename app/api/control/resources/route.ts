import { getD1 } from "../../../../db/runtime";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { createKioskCredentialSecret, hashKioskCredential } from "../../../../lib/server/kiosk-credentials";

const commands = ["set_status", "heartbeat", "issue_kiosk_credential", "revoke_kiosk_credential"] as const;

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT r.id, r.resource_type, r.display_name, r.status, r.room_id, r.health_state, r.last_heartbeat_at, r.version,
      (SELECT rr.appointment_id FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.facility_id = r.facility_id AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.starts_at ASC LIMIT 1) AS active_appointment_id,
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
    if (body.command === "issue_kiosk_credential") {
      const device = await d1.prepare("SELECT id, resource_type FROM resources WHERE id = ? AND facility_id = ?").bind(current.id, authorization.facilityId).first<{ id: string; resource_type: string }>();
      if (device?.resource_type !== "DEVICE") throw new SecurityError("KIOSK_DEVICE_REQUIRED", 409);
      if (body.expectedVersion === undefined) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);
      await requireStepUp("kiosk_credential_issue", authorization.userId);
      const versionClaim = await d1.prepare("UPDATE resources SET version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND resource_type = 'DEVICE' AND version = ?")
        .bind(now, current.id, authorization.facilityId, current.version).run();
      if (!versionClaim.meta.changes) throw new SecurityError("STALE_RESOURCE", 409);

      const secret = createKioskCredentialSecret();
      const credentialId = crypto.randomUUID();
      const credentialHash = await hashKioskCredential(secret);
      const auditId = crypto.randomUUID();
      await d1.batch([
        d1.prepare("UPDATE kiosk_credentials SET status = 'REVOKED', revoked_at = ? WHERE resource_id = ? AND facility_id = ? AND status = 'ACTIVE'").bind(now, current.id, authorization.facilityId),
        d1.prepare("INSERT INTO kiosk_credentials (id, facility_id, resource_id, credential_hash, status, created_by, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)").bind(credentialId, authorization.facilityId, current.id, credentialHash, authorization.userId, now),
        d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, request_id, created_at)
          VALUES (?, ?, ?, ?, 'KIOSK_CREDENTIAL_ISSUED', 'resource', ?, ?, ?, ?, ?, ?)`)
          .bind(auditId, authorization.userId, authorization.roles[0] || null, authorization.facilityId, current.id, reason, JSON.stringify({ credentialStatus: "previous credential revoked" }), JSON.stringify({ credentialStatus: "ACTIVE", credentialId }), context.requestId, now),
      ]);
      return securityResponse({ resourceId: current.id, credential: { token: secret, header: "X-SecureVisit-Kiosk-Token" }, version: current.version + 1, oneTimeDisplay: true }, 201, context.requestId);
    }
    if (body.command === "revoke_kiosk_credential") {
      const device = await d1.prepare("SELECT id, resource_type FROM resources WHERE id = ? AND facility_id = ?").bind(current.id, authorization.facilityId).first<{ id: string; resource_type: string }>();
      if (device?.resource_type !== "DEVICE") throw new SecurityError("KIOSK_DEVICE_REQUIRED", 409);
      if (body.expectedVersion === undefined) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);
      const activeCredential = await d1.prepare("SELECT id FROM kiosk_credentials WHERE resource_id = ? AND facility_id = ? AND status = 'ACTIVE'").bind(current.id, authorization.facilityId).first<{ id: string }>();
      if (!activeCredential) throw new SecurityError("KIOSK_CREDENTIAL_NOT_ACTIVE", 409);
      await requireStepUp("kiosk_credential_revoke", authorization.userId);
      const versionClaim = await d1.prepare("UPDATE resources SET version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND resource_type = 'DEVICE' AND version = ?")
        .bind(now, current.id, authorization.facilityId, current.version).run();
      if (!versionClaim.meta.changes) throw new SecurityError("STALE_RESOURCE", 409);
      await d1.batch([
        d1.prepare("UPDATE kiosk_credentials SET status = 'REVOKED', revoked_at = ? WHERE id = ? AND resource_id = ? AND facility_id = ? AND status = 'ACTIVE'").bind(now, activeCredential.id, current.id, authorization.facilityId),
        d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, request_id, created_at)
          VALUES (?, ?, ?, ?, 'KIOSK_CREDENTIAL_REVOKED', 'resource', ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), authorization.userId, authorization.roles[0] || null, authorization.facilityId, current.id, reason, JSON.stringify({ credentialStatus: "ACTIVE", credentialId: activeCredential.id }), JSON.stringify({ credentialStatus: "REVOKED" }), context.requestId, now),
      ]);
      return securityResponse({ resourceId: current.id, credentialStatus: "REVOKED", version: current.version + 1 }, 200, context.requestId);
    }
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
