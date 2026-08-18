import { getD1 } from "@/db/runtime";
import { getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "@/lib/server/security";
import { assertJoinable, toSessionPayload, type SessionRecord } from "@/lib/server/video/session";
import { createLiveKitProvider, getVideoConfig } from "@/lib/server/video/provider";

type RouteContext = { params: Promise<{ visitId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const kioskId = request.headers.get("x-securevisit-kiosk-id")?.trim();
    if (!kioskId || !/^[A-Za-z0-9._:-]{3,80}$/.test(kioskId)) throw new SecurityError("KIOSK_AUTHENTICATION_REQUIRED", 401);
    const { visitId } = await context.params;
    const d1 = await getD1();
    const session = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, a.visitor_user_id, u.display_name AS visitor_name, a.prisoner_id, a.status AS appointment_status,
        vs.status, vs.provider, vs.provider_room_name, vs.authorized_start_at, vs.authorized_end_at, vs.actual_started_at, vs.actual_ended_at, vs.recording_policy, vs.recording_status, vs.version
      FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id INNER JOIN users u ON u.id = a.visitor_user_id
      INNER JOIN resource_reservations rr ON rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.resource_id = ? AND rr.status IN ('RESERVED', 'ACTIVE')
      WHERE vs.appointment_id = ?`).bind(kioskId, visitId).first<Record<string, string | number | null>>();
    if (!session) throw new SecurityError("KIOSK_NOT_ASSIGNED_TO_VISIT", 403);
    const sessionRecord = session as unknown as SessionRecord;
    assertJoinable(sessionRecord);
    const config = await getVideoConfig();
    if (!config.configured) throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
    const provider = await createLiveKitProvider();
    const token = await provider.createParticipantToken({ roomName: String(session.provider_room_name), identity: `facility:${kioskId}`, name: `Facility kiosk ${kioskId}`, role: "FACILITY" });
    return securityResponse({ token, serverUrl: config.url, session: toSessionPayload(sessionRecord), participantRole: "FACILITY", kioskId, expiresInSeconds: 600 }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}
