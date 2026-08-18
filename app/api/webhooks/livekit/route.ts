import { WebhookReceiver } from "livekit-server-sdk";
import { getD1 } from "@/db/runtime";
import { getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "@/lib/server/security";
import { getVideoConfig } from "@/lib/server/video/provider";

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const config = await getVideoConfig();
    if (!config.configured || !config.apiKey || !config.apiSecret) throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
    const body = await request.text();
    const event = await new WebhookReceiver(config.apiKey, config.apiSecret).receive(body, request.headers.get("Authorization") || undefined);
    const d1 = await getD1();
    const roomName = event.room?.name;
    if (!roomName) return securityResponse({ accepted: true, ignored: true }, 200, context.requestId);
    const session = await d1.prepare("SELECT id, appointment_id, facility_id, status, version FROM visit_sessions WHERE provider_room_name = ?").bind(roomName).first<{ id: string; appointment_id: string; facility_id: string; status: string; version: number }>();
    if (!session) return securityResponse({ accepted: true, ignored: true }, 200, context.requestId);
    const now = new Date().toISOString();
    const eventId = typeof event.id === "string" && event.id ? event.id : crypto.randomUUID();
    const nextStatus = event.event === "room_started" || event.event === "participant_joined" ? "ACTIVE" : event.event === "participant_connection_aborted" ? "RECONNECTING" : event.event === "room_finished" ? "ENDED" : session.status;
    const results = await d1.batch([
      d1.prepare(`INSERT OR IGNORE INTO visit_session_events (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(eventId, session.id, `PROVIDER_${String(event.event || "UNKNOWN").toUpperCase()}`, "LIVEKIT_WEBHOOK", event.participant?.identity?.startsWith("visitor:") ? "VISITOR" : event.participant?.identity?.startsWith("facility:") ? "FACILITY" : null, JSON.stringify({ roomName, participantIdentity: event.participant?.identity || null }), context.requestId, now),
      d1.prepare("UPDATE visit_sessions SET status = ?, actual_started_at = CASE WHEN ? = 'ACTIVE' AND actual_started_at IS NULL THEN ? ELSE actual_started_at END, actual_ended_at = CASE WHEN ? = 'ENDED' THEN ? ELSE actual_ended_at END, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(nextStatus, nextStatus, now, nextStatus, now, now, session.id, session.version),
    ]);
    if (nextStatus === "ENDED" && results[1]?.meta.changes) {
      await d1.batch([
        d1.prepare("UPDATE appointments SET status = 'COMPLETED', version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND status = 'IN_PROGRESS'").bind(now, session.appointment_id, session.facility_id),
        d1.prepare("UPDATE resource_reservations SET status = 'RELEASED' WHERE appointment_id = ? AND facility_id = ? AND status IN ('RESERVED', 'ACTIVE')").bind(session.appointment_id, session.facility_id),
      ]);
    }
    return securityResponse({ accepted: true, event: event.event, sessionId: session.id }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
