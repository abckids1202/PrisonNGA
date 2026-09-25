import { WebhookReceiver } from "livekit-server-sdk";
import { getD1 } from "@/db/runtime";
import { finalizeLiveSessionStatements } from "@/lib/server/live-session-finalization";
import { getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "@/lib/server/security";
import { getVideoConfig } from "@/lib/server/video/provider";
import { enforceRateLimit } from "@/lib/server/rate-limit";

function roleForParticipant(identity: string | undefined): "VISITOR" | "FACILITY" | "STAFF_OBSERVER" | null {
  if (identity?.startsWith("visitor:")) return "VISITOR";
  if (identity?.startsWith("facility:")) return "FACILITY";
  if (identity?.startsWith("observer:")) return "STAFF_OBSERVER";
  return null;
}

function participantAuditAction(event: string | undefined): string | null {
  if (event === "participant_joined") return "LIVE_SESSION_PARTICIPANT_JOINED";
  if (event === "participant_left") return "LIVE_SESSION_PARTICIPANT_DISCONNECTED";
  if (event === "participant_connection_aborted") return "LIVE_SESSION_PARTICIPANT_RECONNECTING";
  return null;
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const config = await getVideoConfig();
    if (!config.configured || !config.apiKey || !config.apiSecret) throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
    const body = await request.text();
    const event = await new WebhookReceiver(config.apiKey, config.apiSecret).receive(body, request.headers.get("Authorization") || undefined);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `livekit-webhook:${context.ipAddress || "unknown"}`, limit: 300, windowSeconds: 60 });
    const roomName = event.room?.name;
    if (!roomName) return securityResponse({ accepted: true, ignored: true }, 200, context.requestId);
    const session = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, vs.status, vs.version, vs.actual_started_at, vs.termination_reason,
      a.status AS appointment_status, a.version AS appointment_version, a.visitor_user_id, ca.id AS credit_account_id,
      (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1) AS kiosk_resource_id
      FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
      LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
      WHERE vs.provider_room_name = ?`).bind(roomName).first<{ id: string; appointment_id: string; facility_id: string; status: string; version: number; actual_started_at: string | null; termination_reason: string | null; appointment_status: string; appointment_version: number; visitor_user_id: string; credit_account_id: string | null; kiosk_resource_id: string | null }>();
    if (!session) return securityResponse({ accepted: true, ignored: true }, 200, context.requestId);
    const now = new Date().toISOString();
    const eventId = typeof event.id === "string" ? event.id.trim() : "";
    if (!eventId) throw new SecurityError("LIVEKIT_WEBHOOK_EVENT_ID_REQUIRED", 400);
    const eventType = `PROVIDER_${String(event.event || "UNKNOWN").toUpperCase()}`;
    const participantIdentity = event.participant?.identity || null;
    const participantRole = roleForParticipant(participantIdentity || undefined);
    const expectedParticipant = participantRole === "VISITOR"
      ? `visitor:${session.visitor_user_id}`
      : participantRole === "FACILITY" && session.kiosk_resource_id
        ? `facility:${session.kiosk_resource_id}`
        : null;
    if (expectedParticipant && participantIdentity !== expectedParticipant) {
      return securityResponse({ accepted: true, ignored: true, reason: "PARTICIPANT_NOT_ASSIGNED_TO_VISIT", sessionId: session.id }, 200, context.requestId);
    }
    if ((participantRole === "VISITOR" || participantRole === "FACILITY") && !expectedParticipant) {
      return securityResponse({ accepted: true, ignored: true, reason: "PARTICIPANT_ASSIGNMENT_UNAVAILABLE", sessionId: session.id }, 200, context.requestId);
    }
    const eventMetadata = { roomName, participantIdentity, participantSid: event.participant?.sid || null };
    const priorEvent = await d1.prepare("SELECT session_id, event_type FROM visit_session_events WHERE id = ?").bind(eventId).first<{ session_id: string; event_type: string }>();
    if (priorEvent) {
      if (priorEvent.session_id !== session.id || priorEvent.event_type !== eventType) throw new SecurityError("LIVEKIT_EVENT_ID_REUSED", 409);
      if (event.event !== "room_finished" || ["ENDED", "TERMINATED", "CANCELLED"].includes(session.status)) {
        return securityResponse({ accepted: true, idempotent: true, event: event.event, sessionId: session.id }, 200, context.requestId);
      }
    }

    if (event.event === "room_finished") {
      const staffTerminationReason = session.termination_reason?.startsWith("STAFF_TERMINATE:")
        ? session.termination_reason.slice("STAFF_TERMINATE:".length)
        : null;
      const terminating = Boolean(staffTerminationReason) || !session.actual_started_at;
      const finalSessionStatus = terminating ? "TERMINATED" : "ENDED";
      const finalAppointmentStatus = terminating ? "TECHNICAL_FAILURE" : "COMPLETED";
      const creditEntryType = terminating ? "RESERVATION_RELEASE" : "CONSUMPTION";
      if (session.status === finalSessionStatus && session.appointment_status === finalAppointmentStatus) {
        const settled = await d1.prepare("SELECT id FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = ?")
          .bind(session.appointment_id, session.credit_account_id || "", creditEntryType).first();
        if (settled) return securityResponse({ accepted: true, idempotent: true, event: event.event, sessionId: session.id }, 200, context.requestId);
        throw new SecurityError("SESSION_SETTLEMENT_REQUIRES_RECONCILIATION", 503);
      }
      if (!session.credit_account_id) throw new SecurityError("CREDIT_RESERVATION_NOT_FOUND", 409);
      const correlationId = crypto.randomUUID();
      const finalized = await d1.batch(finalizeLiveSessionStatements(d1, {
        sessionId: session.id,
        appointmentId: session.appointment_id,
        facilityId: session.facility_id,
        sessionVersion: session.version,
        sessionStatus: session.status,
        finalSessionStatus,
        appointmentVersion: session.appointment_version,
        finalAppointmentStatus,
        creditAccountId: session.credit_account_id,
        creditOutcome: terminating ? "RELEASE" : "CONSUME",
        actorUserId: "system:livekit",
        actorRole: "SYSTEM",
        requestId: context.requestId,
        correlationId,
        now,
        reason: staffTerminationReason || (terminating ? "LiveKit room ended before the visit started." : "LiveKit room completed."),
        event: { id: eventId, eventType, source: "LIVEKIT_WEBHOOK", participantRole, metadata: eventMetadata },
      }));
      if (finalized[1]?.meta.changes && finalized[2]?.meta.changes && finalized[4]?.meta.changes) {
        return securityResponse({ accepted: true, event: event.event, sessionId: session.id, sessionStatus: finalSessionStatus, appointmentStatus: finalAppointmentStatus, creditOutcome: terminating ? "RELEASE" : "CONSUME", correlationId }, 200, context.requestId);
      }
      const latest = await d1.prepare(`SELECT vs.status, a.status AS appointment_status
        FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
        WHERE vs.id = ? AND vs.facility_id = ?`).bind(session.id, session.facility_id).first<{ status: string; appointment_status: string }>();
      if (latest?.status === finalSessionStatus && latest.appointment_status === finalAppointmentStatus) {
        const settled = await d1.prepare("SELECT id FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = ?")
          .bind(session.appointment_id, session.credit_account_id, creditEntryType).first();
        if (settled) return securityResponse({ accepted: true, idempotent: true, event: event.event, sessionId: session.id }, 200, context.requestId);
      }
      throw new SecurityError("LIVE_SESSION_FINALIZATION_CONFLICT", 409);
    }

    const participantStarted = event.event === "participant_joined" && (participantRole === "VISITOR" || participantRole === "FACILITY");
    const participantReconnecting = (event.event === "participant_connection_aborted" || event.event === "participant_left") && (participantRole === "VISITOR" || participantRole === "FACILITY");
    const nextStatus = session.status === "ENDING" ? session.status : participantStarted ? "ACTIVE" : participantReconnecting ? "RECONNECTING" : session.status;
    const statements = [
      d1.prepare(`INSERT OR IGNORE INTO visit_session_events (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
        VALUES (?, ?, ?, 'LIVEKIT_WEBHOOK', ?, ?, ?, ?)`)
        .bind(eventId, session.id, eventType, participantRole, JSON.stringify(eventMetadata), context.requestId, now),
    ];
    if (participantIdentity && participantRole && ["participant_joined", "participant_left", "participant_connection_aborted"].includes(event.event || "")) {
      const participantStatus = event.event === "participant_joined" ? "CONNECTED" : event.event === "participant_connection_aborted" ? "RECONNECTING" : "DISCONNECTED";
      statements.push(d1.prepare(`INSERT INTO visit_session_participants (id, session_id, facility_id, identity, participant_role, participant_sid, status, first_seen_at, last_seen_at, disconnected_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, identity) DO UPDATE SET participant_sid = excluded.participant_sid, status = excluded.status, last_seen_at = excluded.last_seen_at, disconnected_at = excluded.disconnected_at, metadata = excluded.metadata`)
        .bind(crypto.randomUUID(), session.id, session.facility_id, participantIdentity, participantRole, event.participant?.sid || null, participantStatus, now, now, participantStatus === "DISCONNECTED" ? now : null, JSON.stringify(eventMetadata)));
      const auditAction = participantAuditAction(event.event);
      if (auditAction) {
        // Provider presence events are operationally sensitive but should not
        // create a visitor notification for every reconnect/observer change.
        // Keep them in the immutable facility audit trail instead.
        const auditId = crypto.randomUUID();
        statements.push(d1.prepare(`INSERT INTO audit_events
          (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
          SELECT ?, 'system:livekit', 'SYSTEM', ?, ?, 'visit_session', ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM visit_session_events WHERE id = ? AND session_id = ?)`)
          .bind(
            auditId,
            session.facility_id,
            auditAction,
            session.id,
            `LiveKit provider reported ${event.event} for ${participantRole}.`,
            JSON.stringify({ participantRole, participantIdentity, providerStatus: "UNKNOWN" }),
            JSON.stringify({ participantRole, participantIdentity, providerStatus: participantStatus, participantSid: event.participant?.sid || null }),
            context.requestId,
            context.requestId,
            now,
            eventId,
            session.id,
          ));
      }
    }
    if (nextStatus !== session.status || (nextStatus === "ACTIVE" && !session.actual_started_at)) {
      statements.push(d1.prepare(`UPDATE visit_sessions SET status = ?, actual_started_at = CASE WHEN ? = 'ACTIVE' AND actual_started_at IS NULL THEN ? ELSE actual_started_at END,
        version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status = ?
        AND EXISTS (SELECT 1 FROM appointments WHERE id = ? AND facility_id = ? AND status = 'IN_PROGRESS')
        AND changes() = 1`)
        .bind(nextStatus, nextStatus, now, now, session.id, session.version, session.status, session.appointment_id, session.facility_id));
    }
    const results = await d1.batch(statements);
    if (!results[0]?.meta.changes) return securityResponse({ accepted: true, idempotent: true, event: event.event, sessionId: session.id }, 200, context.requestId);
    return securityResponse({ accepted: true, event: event.event, sessionId: session.id }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
