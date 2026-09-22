import { auditAndOutboxStatements } from "./events";

export type AppointmentDecisionInput = {
  appointmentId: string;
  facilityId: string;
  visitorUserId: string;
  fromStatus: string;
  toStatus: string;
  expectedVersion: number;
  actorUserId: string;
  actorRole: string;
  command: string;
  reason: string;
  requestId: string;
  correlationId: string;
  now: string;
};

export function appointmentDecisionStatements(d1: D1Database, input: AppointmentDecisionInput): D1PreparedStatement[] {
  const guard = {
    sql: "EXISTS (SELECT 1 FROM appointments WHERE id = ? AND facility_id = ? AND status = ? AND version = ? AND last_transition_id = ?)",
    values: [input.appointmentId, input.facilityId, input.toStatus, input.expectedVersion + 1, input.correlationId],
  };

  return [
    d1.prepare(`UPDATE appointments SET status = ?, version = version + 1, updated_at = ?, last_transition_id = ?
      WHERE id = ? AND facility_id = ? AND status = ? AND version = ?`)
      .bind(input.toStatus, input.now, input.correlationId, input.appointmentId, input.facilityId, input.fromStatus, input.expectedVersion),
    d1.prepare(`INSERT INTO appointment_status_events
      (id, appointment_id, from_status, to_status, actor_user_id, reason_code, reason_text, correlation_id, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`)
      .bind(crypto.randomUUID(), input.appointmentId, input.fromStatus, input.toStatus, input.actorUserId, `STAFF_${input.command.toUpperCase()}`, input.reason, input.correlationId, input.now, ...guard.values),
    ...auditAndOutboxStatements(d1, {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      facilityId: input.facilityId,
      actionType: `APPOINTMENT_${input.command.toUpperCase()}`,
      entityType: "appointment",
      entityId: input.appointmentId,
      reason: input.reason,
      oldValues: { status: input.fromStatus },
      newValues: { status: input.toStatus },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: `APPOINTMENT_${input.command.toUpperCase()}`,
      payload: { appointmentId: input.appointmentId, status: input.toStatus, visitorUserId: input.visitorUserId },
    }, guard),
  ];
}
