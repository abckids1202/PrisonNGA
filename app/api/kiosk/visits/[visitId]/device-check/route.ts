import { getD1 } from "../../../../../../db/runtime";
import { authenticateKiosk } from "../../../../../../lib/server/kiosk-credentials";
import { enforceRateLimit } from "../../../../../../lib/server/rate-limit";
import { getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";

const deviceResults = ["ready", "warning", "failed"] as const;
const networkResults = ["stable", "fair", "poor", "unknown"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ visitId: string }> }) {
  const context = await getRequestContext();
  try {
    const { visitId } = await params;
    if (!visitId || visitId.length > 128) throw new SecurityError("VISIT_NOT_FOUND", 404);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const body = await request.json() as { cameraResult?: unknown; microphoneResult?: unknown; networkResult?: unknown; latencyMs?: unknown };
    if (!deviceResults.includes(body.cameraResult as typeof deviceResults[number]) || !deviceResults.includes(body.microphoneResult as typeof deviceResults[number]) || !networkResults.includes(body.networkResult as typeof networkResults[number])) throw new SecurityError("INVALID_KIOSK_DEVICE_CHECK", 400);
    const latencyMs = body.latencyMs === null || body.latencyMs === undefined ? null : Number(body.latencyMs);
    if (latencyMs !== null && (!Number.isSafeInteger(latencyMs) || latencyMs < 0 || latencyMs > 60000)) throw new SecurityError("INVALID_KIOSK_DEVICE_CHECK", 400);

    const d1 = await getD1();
    const kiosk = await authenticateKiosk(d1, request);
    if (!kiosk) throw new SecurityError("KIOSK_AUTHENTICATION_REQUIRED", 401);
    const storedKey = `${kiosk.facilityId}:${kiosk.resourceId}:${visitId}:${idempotencyKey}`;
    const existing = await d1.prepare(`SELECT id, appointment_id, resource_id, camera_result, microphone_result, network_result, latency_ms, created_at
      FROM kiosk_device_check_attempts WHERE idempotency_key = ?`).bind(storedKey).first<Record<string, string | number | null>>();
    if (existing) {
      if (existing.appointment_id !== visitId || existing.resource_id !== kiosk.resourceId || existing.camera_result !== body.cameraResult || existing.microphone_result !== body.microphoneResult || existing.network_result !== body.networkResult || (existing.latency_ms ?? null) !== latencyMs) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
      return securityResponse({ deviceCheck: existing, idempotent: true }, 200, context.requestId);
    }
    await enforceRateLimit(d1, { key: `kiosk-device-check:${kiosk.facilityId}:${kiosk.resourceId}:${visitId}`, limit: 12, windowSeconds: 60 * 60 });
    const current = await d1.prepare(`SELECT a.id, a.version AS appointment_version, a.status AS appointment_status, a.facility_id,
        f.current_state AS facility_state, w.version AS waiting_version, w.state, w.visitor_presence, w.prisoner_presence
      FROM appointments a
      INNER JOIN facilities f ON f.id = a.facility_id
      INNER JOIN waiting_room_sessions w ON w.appointment_id = a.id AND w.facility_id = a.facility_id
      LEFT JOIN resource_reservations rr ON rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.resource_id = ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')
      WHERE a.id = ? AND a.facility_id = ? AND (rr.appointment_id IS NOT NULL OR w.assigned_kiosk_id = ?)`)
      .bind(kiosk.resourceId, visitId, kiosk.facilityId, kiosk.resourceId).first<Record<string, string | number | null>>();
    if (!current) throw new SecurityError("KIOSK_NOT_ASSIGNED_TO_VISIT", 403);
    if (!['APPROVED', 'WAITING', 'IN_PROGRESS'].includes(String(current.appointment_status))) throw new SecurityError("VISIT_NOT_READY_FOR_DEVICE_CHECK", 409);
    if (current.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const checkId = crypto.randomUUID();
    const nextVersion = Number(current.waiting_version || 0) + 1;
    const statements = [
      d1.prepare(`UPDATE waiting_room_sessions SET kiosk_camera_state = ?, kiosk_microphone_state = ?, kiosk_network_state = ?, kiosk_device_checked_at = ?, kiosk_state = 'pass', version = ?, last_checked_at = ?, updated_at = ?
        WHERE appointment_id = ? AND facility_id = ? AND version = ? AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = ? AND a.facility_id = ? AND a.version = ? AND a.status IN ('APPROVED', 'WAITING', 'IN_PROGRESS'))`)
        .bind(body.cameraResult, body.microphoneResult, body.networkResult, now, nextVersion, now, now, visitId, kiosk.facilityId, Number(current.waiting_version || 0), visitId, kiosk.facilityId, Number(current.appointment_version || 1)),
      d1.prepare(`INSERT INTO kiosk_device_check_attempts (id, facility_id, appointment_id, resource_id, idempotency_key, camera_result, microphone_result, network_result, latency_ms, correlation_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(checkId, kiosk.facilityId, visitId, kiosk.resourceId, storedKey, body.cameraResult, body.microphoneResult, body.networkResult, latencyMs, correlationId, now),
      d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
        SELECT ?, NULL, 'KIOSK', ?, 'KIOSK_DEVICE_CHECK_RECORDED', 'waiting_room', ?, 'Controlled kiosk reported device readiness.', ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), kiosk.facilityId, visitId, JSON.stringify({ version: current.waiting_version || 0, state: current.state || "NOT_ARRIVED" }), JSON.stringify({ version: nextVersion, cameraResult: body.cameraResult, microphoneResult: body.microphoneResult, networkResult: body.networkResult }), correlationId, context.requestId, now),
      d1.prepare(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
        SELECT ?, 'KIOSK_DEVICE_CHECK_RECORDED', 'appointment', ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), visitId, kiosk.facilityId, JSON.stringify({ appointmentId: visitId, resourceId: kiosk.resourceId, cameraResult: body.cameraResult, microphoneResult: body.microphoneResult, networkResult: body.networkResult }), correlationId, now),
    ];
    const result = await d1.batch(statements);
    if (!result[0]?.meta.changes || !result[1]?.meta.changes) throw new SecurityError("STALE_WAITING_ROOM_STATE", 409);
    return securityResponse({ deviceCheck: { id: checkId, appointmentId: visitId, resourceId: kiosk.resourceId, cameraResult: body.cameraResult, microphoneResult: body.microphoneResult, networkResult: body.networkResult, latencyMs, createdAt: now, correlationId }, idempotent: false }, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
