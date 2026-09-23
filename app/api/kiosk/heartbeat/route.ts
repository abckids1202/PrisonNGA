import { getD1 } from "../../../../db/runtime";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";
import { authenticateKiosk } from "../../../../lib/server/kiosk-credentials";
import { getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const d1 = await getD1();
    const kiosk = await authenticateKiosk(d1, request);
    if (!kiosk) throw new SecurityError("KIOSK_AUTHENTICATION_REQUIRED", 401);
    await enforceRateLimit(d1, { key: `kiosk-heartbeat:${kiosk.resourceId}`, limit: 30, windowSeconds: 60 });
    const now = new Date().toISOString();
    const result = await d1.prepare(`UPDATE resources
      SET last_heartbeat_at = ?, health_state = 'HEALTHY', version = version + 1, updated_at = ?
      WHERE id = ? AND facility_id = ? AND resource_type = 'DEVICE' AND status = 'ONLINE'`)
      .bind(now, now, kiosk.resourceId, kiosk.facilityId).run();
    if (!result.meta.changes) throw new SecurityError("KIOSK_RESOURCE_UNAVAILABLE", 409);
    return securityResponse({ resourceId: kiosk.resourceId, facilityId: kiosk.facilityId, heartbeatAt: now }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
