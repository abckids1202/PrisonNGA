import { getD1 } from "../../../../../../db/runtime";
import { enforceRateLimit } from "../../../../../../lib/server/rate-limit";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";
import { createVisitorDeviceCheckStatements } from "../../../../../../lib/server/visitor-appointment-detail";

type DeviceResult = "ready" | "warning" | "failed";
type NetworkResult = "stable" | "fair" | "poor" | "unknown";

export async function POST(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const { appointmentId } = await params;
    if (!appointmentId || appointmentId.length > 128) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    const body = await request.json() as { cameraResult?: unknown; microphoneResult?: unknown; networkResult?: unknown; latencyMs?: unknown };
    const cameraResult = body.cameraResult;
    const microphoneResult = body.microphoneResult;
    const networkResult = body.networkResult;
    const latencyMs = body.latencyMs === null || body.latencyMs === undefined ? null : Number(body.latencyMs);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    if (!( ["ready", "warning", "failed"] as unknown[]).includes(cameraResult) || !( ["ready", "warning", "failed"] as unknown[]).includes(microphoneResult)) throw new SecurityError("INVALID_DEVICE_CHECK", 400);
    if (!( ["stable", "fair", "poor", "unknown"] as unknown[]).includes(networkResult)) throw new SecurityError("INVALID_DEVICE_CHECK", 400);
    if (latencyMs !== null && (!Number.isSafeInteger(latencyMs) || latencyMs < 0 || latencyMs > 60000)) throw new SecurityError("INVALID_DEVICE_CHECK", 400);

    const d1 = await getD1();
    const storedIdempotencyKey = `${visitor.userId}:${idempotencyKey}`;
    const existing = await d1.prepare(`SELECT id, appointment_id, visitor_user_id, camera_result, microphone_result, network_result, latency_ms, created_at
      FROM visitor_device_check_attempts WHERE idempotency_key = ?`).bind(storedIdempotencyKey).first<Record<string, string | number | null>>();
    if (existing) {
      if (existing.appointment_id !== appointmentId || existing.visitor_user_id !== visitor.userId) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
      if (existing.camera_result !== cameraResult || existing.microphone_result !== microphoneResult || existing.network_result !== networkResult || (existing.latency_ms ?? null) !== latencyMs) throw new SecurityError("IDEMPOTENCY_KEY_REUSED", 409);
      return securityResponse({ deviceCheck: existing, idempotent: true }, 200, context.requestId);
    }

    await enforceRateLimit(d1, { key: `visitor-device-check:${visitor.userId}:${appointmentId}`, limit: 10, windowSeconds: 60 * 60 });
    const eligible = await d1.prepare(`SELECT a.facility_id FROM appointments a
      INNER JOIN facilities f ON f.id = a.facility_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
      WHERE a.id = ? AND a.visitor_user_id = ? AND a.status IN ('APPROVED', 'WAITING')
        AND a.requested_end > ? AND f.current_state = 'NORMAL_OPERATIONS'
        AND p.status = 'ACTIVE' AND p.visitation_status = 'APPROVED'`)
      .bind(appointmentId, visitor.userId, new Date().toISOString()).first<{ facility_id: string }>();
    if (!eligible) throw new SecurityError("VISIT_NOT_ELIGIBLE_FOR_DEVICE_CHECK", 409);

    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const deviceCheckId = crypto.randomUUID();
    const statements = createVisitorDeviceCheckStatements(d1, {
      id: deviceCheckId, facilityId: eligible.facility_id, appointmentId, visitorUserId: visitor.userId,
      idempotencyKey: storedIdempotencyKey,
      cameraResult: cameraResult as DeviceResult,
      microphoneResult: microphoneResult as DeviceResult,
      networkResult: networkResult as NetworkResult,
      latencyMs, correlationId, requestId: context.requestId, now,
    });
    const result = await d1.batch(statements);
    if (!result[0]?.meta.changes) {
      const raced = await d1.prepare(`SELECT id, appointment_id, visitor_user_id, camera_result, microphone_result, network_result, latency_ms, created_at
        FROM visitor_device_check_attempts WHERE idempotency_key = ?`).bind(storedIdempotencyKey).first<Record<string, string | number | null>>();
      if (raced?.appointment_id === appointmentId && raced.visitor_user_id === visitor.userId) return securityResponse({ deviceCheck: raced, idempotent: true }, 200, context.requestId);
      throw new SecurityError("VISIT_NOT_ELIGIBLE_FOR_DEVICE_CHECK", 409);
    }
    return securityResponse({ deviceCheck: { id: deviceCheckId, appointmentId, cameraResult, microphoneResult, networkResult, latencyMs, createdAt: now, correlationId } }, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
