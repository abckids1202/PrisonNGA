import { getD1 } from "@/db/runtime";
import { getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "@/lib/server/security";
import { authenticateKiosk } from "@/lib/server/kiosk-credentials";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { assertVisitorJoinAllowed, toSessionPayload, type SessionRecord } from "@/lib/server/video/session";
import { createLiveKitProvider, getVideoConfig } from "@/lib/server/video/provider";

type RouteContext = { params: Promise<{ visitId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const kioskId = request.headers.get("x-securevisit-kiosk-id")?.trim() || "";
    const kioskSecret = request.headers.get("x-securevisit-kiosk-token")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{3,80}$/u.test(kioskId) || !/^[A-Za-z0-9_-]{40,60}$/u.test(kioskSecret)) throw new SecurityError("KIOSK_AUTHENTICATION_REQUIRED", 401);
    const d1 = await getD1();
    const kiosk = await authenticateKiosk(d1, request);
    if (!kiosk) throw new SecurityError("KIOSK_AUTHENTICATION_REQUIRED", 401);
    const { visitId } = await context.params;
    const session = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, a.visitor_user_id, u.display_name AS visitor_name, p.display_name AS prisoner_name, a.prisoner_id, a.status AS appointment_status, a.version AS appointment_version,
        p.status AS prisoner_status, p.visitation_status, f.current_state AS facility_state,
        vs.status, vs.provider, vs.provider_room_name, vs.authorized_start_at, vs.authorized_end_at, vs.actual_started_at, vs.actual_ended_at, vs.termination_reason, vs.recording_policy, vs.recording_status, vs.version
      FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id INNER JOIN users u ON u.id = a.visitor_user_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
      INNER JOIN facilities f ON f.id = a.facility_id
      INNER JOIN resource_reservations rr ON rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.resource_id = ?
        AND (rr.status IN ('RESERVED', 'ACTIVE') OR vs.status IN ('ENDED', 'TERMINATED', 'FAILED', 'CANCELLED'))
      WHERE vs.appointment_id = ? AND vs.facility_id = ?`).bind(kiosk.resourceId, visitId, kiosk.facilityId).first<Record<string, string | number | null>>();
    if (!session) throw new SecurityError("KIOSK_NOT_ASSIGNED_TO_VISIT", 403);
    return securityResponse({ session: toSessionPayload(session as unknown as SessionRecord) }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const kioskId = request.headers.get("x-securevisit-kiosk-id")?.trim() || "";
    const kioskSecret = request.headers.get("x-securevisit-kiosk-token")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{3,80}$/u.test(kioskId) || !/^[A-Za-z0-9_-]{40,60}$/u.test(kioskSecret)) {
      throw new SecurityError("KIOSK_AUTHENTICATION_REQUIRED", 401);
    }
    const d1 = await getD1();
    const kiosk = await authenticateKiosk(d1, request);
    if (!kiosk) throw new SecurityError("KIOSK_AUTHENTICATION_REQUIRED", 401);
    const { visitId } = await context.params;
    await enforceRateLimit(d1, { key: `kiosk-live-token:${kiosk.facilityId}:${kiosk.resourceId}:${visitId}`, limit: 12, windowSeconds: 60 * 10 });
    const session = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, a.visitor_user_id, u.display_name AS visitor_name, p.display_name AS prisoner_name, a.prisoner_id, a.status AS appointment_status, a.version AS appointment_version,
        p.status AS prisoner_status, p.visitation_status, f.current_state AS facility_state,
        vs.status, vs.provider, vs.provider_room_name, vs.authorized_start_at, vs.authorized_end_at, vs.actual_started_at, vs.actual_ended_at, vs.termination_reason, vs.recording_policy, vs.recording_status, vs.version
      FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id INNER JOIN users u ON u.id = a.visitor_user_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
      INNER JOIN facilities f ON f.id = a.facility_id
      INNER JOIN resource_reservations rr ON rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.resource_id = ? AND rr.status IN ('RESERVED', 'ACTIVE')
      WHERE vs.appointment_id = ? AND vs.facility_id = ?`).bind(kiosk.resourceId, visitId, kiosk.facilityId).first<Record<string, string | number | null>>();
    if (!session) throw new SecurityError("KIOSK_NOT_ASSIGNED_TO_VISIT", 403);
    const sessionRecord = session as unknown as SessionRecord;
    assertVisitorJoinAllowed(sessionRecord);
    const config = await getVideoConfig();
    if (!config.configured) throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
    const provider = await createLiveKitProvider();
    const token = await provider.createParticipantToken({ roomName: String(session.provider_room_name), identity: `facility:${kiosk.resourceId}`, name: `Facility kiosk ${kiosk.resourceId}`, role: "FACILITY" });
    return securityResponse({ token, serverUrl: config.url, session: toSessionPayload(sessionRecord), participantRole: "FACILITY", kioskId: kiosk.resourceId, expiresInSeconds: 600 }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}
