import { auditAndOutboxStatements } from "./events";

export type ScheduledWaitingRoomOpenInput = {
  appointmentId: string;
  facilityId: string;
  requestedStart: string;
  requestedEnd: string;
  now: string;
  requestId: string;
  correlationId: string;
};

/** Materialize an approved visit's Waiting Room record exactly once. */
export function openScheduledWaitingRoomStatements(d1: D1Database, input: ScheduledWaitingRoomOpenInput): D1PreparedStatement[] {
  return [
    d1.prepare(`INSERT INTO waiting_room_sessions
      (appointment_id, facility_id, state, visitor_presence, prisoner_presence,
       identity_state, camera_state, microphone_state, network_state, room_state,
       kiosk_state, restriction_state, assigned_room_id, assigned_kiosk_id,
       version, last_checked_at, created_at, updated_at)
      SELECT ?, ?, 'NOT_ARRIVED', 'absent', 'waiting', 'pending', 'pending',
        'pending', 'pending', 'pass', 'pending', 'pass',
        (SELECT rr.resource_id FROM resource_reservations rr
          WHERE rr.appointment_id = ? AND rr.facility_id = ?
            AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')
          ORDER BY rr.created_at DESC LIMIT 1),
        (SELECT rr.resource_id FROM resource_reservations rr
          WHERE rr.appointment_id = ? AND rr.facility_id = ?
            AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')
          ORDER BY rr.created_at DESC LIMIT 1),
        1, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM waiting_room_sessions
        WHERE appointment_id = ? AND facility_id = ?
      )`)
      .bind(input.appointmentId, input.facilityId, input.appointmentId, input.facilityId, input.appointmentId, input.facilityId, input.now, input.now, input.now, input.appointmentId, input.facilityId),
    ...auditAndOutboxStatements(d1, {
      actorUserId: "system:scheduler",
      actorRole: "SYSTEM",
      facilityId: input.facilityId,
      actionType: "WAITING_ROOM_OPENED",
      entityType: "appointment",
      entityId: input.appointmentId,
      reason: "The approved visit entered its ten-minute Waiting Room opening window.",
      oldValues: { appointmentStatus: "APPROVED", waitingRoom: "NOT_MATERIALIZED" },
      newValues: { waitingRoom: "NOT_ARRIVED", requestedStart: input.requestedStart, requestedEnd: input.requestedEnd },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: "WAITING_ROOM_OPENED",
      payload: { appointmentId: input.appointmentId, requestedStart: input.requestedStart, requestedEnd: input.requestedEnd },
    }, { sql: "changes() > 0", values: [] }),
  ];
}
