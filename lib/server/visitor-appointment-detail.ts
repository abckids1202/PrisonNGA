export type VisitorAppointmentDetailInput = {
  appointmentId: string;
  visitorUserId: string;
};

export function visitorAppointmentDetailStatement(
  d1: D1Database,
  input: VisitorAppointmentDetailInput,
): D1PreparedStatement {
  return d1.prepare(`SELECT
      a.id, a.facility_id, f.name AS facility_name, f.current_state AS facility_state,
      a.prisoner_id, p.prisoner_number, p.display_name AS prisoner_name,
      p.status AS prisoner_status, p.visitation_status,
      vr.relationship_type,
      a.status, a.requested_start, a.requested_end, a.timezone,
      a.appointment_type, a.version, a.created_at, a.updated_at,
      wr.state AS waiting_room_state, wr.visitor_presence, wr.prisoner_presence,
      wr.identity_state, wr.camera_state, wr.microphone_state, wr.network_state,
      wr.room_state, wr.kiosk_state, wr.restriction_state, wr.last_checked_at AS staff_preflight_at,
      vs.id AS session_id, vs.status AS session_status, vs.authorized_start_at,
      vs.authorized_end_at, vs.actual_started_at, vs.actual_ended_at,
      vs.recording_policy, vs.recording_status,
      dc.id AS device_check_id, dc.camera_result AS device_camera_result,
      dc.microphone_result AS device_microphone_result, dc.network_result AS device_network_result,
      dc.latency_ms AS device_latency_ms, dc.created_at AS device_checked_at,
      CASE
        WHEN EXISTS (SELECT 1 FROM credit_ledger_entries cle WHERE cle.appointment_id = a.id AND cle.entry_type = 'CONSUMPTION') THEN 'CONSUMED'
        WHEN EXISTS (SELECT 1 FROM credit_ledger_entries cle WHERE cle.appointment_id = a.id AND cle.entry_type = 'RESERVATION_RELEASE') THEN 'RETURNED'
        WHEN EXISTS (SELECT 1 FROM credit_ledger_entries cle WHERE cle.appointment_id = a.id AND cle.entry_type = 'RESERVATION') THEN 'RESERVED'
        ELSE 'NOT_RESERVED'
      END AS visit_credit_status
    FROM appointments a
    INNER JOIN facilities f ON f.id = a.facility_id
    INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
    LEFT JOIN visitor_relationships vr ON vr.visitor_user_id = a.visitor_user_id AND vr.prisoner_id = a.prisoner_id AND vr.facility_id = a.facility_id
    LEFT JOIN waiting_room_sessions wr ON wr.appointment_id = a.id AND wr.facility_id = a.facility_id
    LEFT JOIN visit_sessions vs ON vs.appointment_id = a.id AND vs.facility_id = a.facility_id
    LEFT JOIN visitor_device_check_attempts dc ON dc.id = (
      SELECT latest.id FROM visitor_device_check_attempts latest
      WHERE latest.appointment_id = a.id AND latest.visitor_user_id = a.visitor_user_id
      ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
    )
    WHERE a.id = ? AND a.visitor_user_id = ?`)
    .bind(input.appointmentId, input.visitorUserId);
}

export function visitorAppointmentHistoryStatement(
  d1: D1Database,
  input: VisitorAppointmentDetailInput,
): D1PreparedStatement {
  return d1.prepare(`SELECT e.from_status, e.to_status, e.created_at
    FROM appointment_status_events e
    INNER JOIN appointments a ON a.id = e.appointment_id
    WHERE a.id = ? AND a.visitor_user_id = ?
    ORDER BY e.created_at ASC, e.id ASC`)
    .bind(input.appointmentId, input.visitorUserId);
}

export type VisitorDeviceCheckInput = {
  id: string;
  facilityId: string;
  appointmentId: string;
  visitorUserId: string;
  idempotencyKey: string;
  cameraResult: "ready" | "warning" | "failed";
  microphoneResult: "ready" | "warning" | "failed";
  networkResult: "stable" | "fair" | "poor" | "unknown";
  latencyMs: number | null;
  correlationId: string;
  requestId: string;
  now: string;
};

export function createVisitorDeviceCheckStatements(d1: D1Database, input: VisitorDeviceCheckInput): D1PreparedStatement[] {
  return [
    d1.prepare(`INSERT OR IGNORE INTO visitor_device_check_attempts
      (id, facility_id, appointment_id, visitor_user_id, idempotency_key, camera_result, microphone_result, network_result, latency_ms, correlation_id, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM appointments a
        INNER JOIN facilities f ON f.id = a.facility_id
        INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
        WHERE a.id = ? AND a.facility_id = ? AND a.visitor_user_id = ?
          AND a.status IN ('APPROVED', 'WAITING')
          AND a.requested_end > ?
          AND f.current_state = 'NORMAL_OPERATIONS'
          AND p.status = 'ACTIVE' AND p.visitation_status = 'APPROVED'
      )`)
      .bind(input.id, input.facilityId, input.appointmentId, input.visitorUserId, input.idempotencyKey, input.cameraResult, input.microphoneResult, input.networkResult, input.latencyMs, input.correlationId, input.now, input.appointmentId, input.facilityId, input.visitorUserId, input.now),
    d1.prepare(`INSERT INTO audit_events
      (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, new_values, correlation_id, request_id, created_at)
      SELECT ?, ?, 'VISITOR', ?, 'VISITOR_DEVICE_CHECK_RECORDED', 'appointment', ?, 'Visitor device check submitted.', ?, ?, ?, ?
      WHERE changes() = 1`)
      .bind(crypto.randomUUID(), input.visitorUserId, input.facilityId, input.appointmentId, JSON.stringify({ camera: input.cameraResult, microphone: input.microphoneResult, network: input.networkResult, latencyMs: input.latencyMs }), input.correlationId, input.requestId, input.now),
  ];
}
