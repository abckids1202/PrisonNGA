import { auditAndOutboxStatements } from "./events";

const activeAppointmentStatuses = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "WAITING", "IN_PROGRESS"] as const;

export type CreateVisitorAppointmentInput = {
  appointmentId: string;
  facilityId: string;
  visitorUserId: string;
  prisonerId: string;
  relationshipId: string;
  requestedStart: string;
  requestedEnd: string;
  timezone: string;
  policyVersion: number;
  durationMinutes: number;
  appointmentType: string;
  now: string;
  correlationId: string;
  requestId: string;
  idempotency: { claimId: string; scope: string; key: string };
  responseBody: { appointmentId: string; status: "SUBMITTED"; correlationId: string };
};

/**
 * Creates an appointment and its initial workflow records in one D1 batch.
 * Overlap and eligibility predicates are repeated in the INSERT itself so
 * competing requests cannot both claim the same visitor/prisoner time window.
 */
export function createVisitorAppointmentStatements(d1: D1Database, input: CreateVisitorAppointmentInput): D1PreparedStatement[] {
  const activePlaceholders = activeAppointmentStatuses.map(() => "?").join(", ");
  const transitionGuard = {
    sql: "EXISTS (SELECT 1 FROM appointments WHERE id = ? AND last_transition_id = ? AND status = 'SUBMITTED')",
    values: [input.appointmentId, input.correlationId],
  };

  return [
    d1.prepare(`INSERT INTO appointments
      (id, facility_id, visitor_user_id, prisoner_id, status, requested_start, requested_end, timezone, policy_version, duration_minutes, appointment_type, version, created_at, updated_at, last_transition_id)
      SELECT ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING')
        AND EXISTS (
          SELECT 1 FROM visitor_relationships vr
          INNER JOIN prisoners p ON p.id = vr.prisoner_id AND p.facility_id = vr.facility_id
          WHERE vr.id = ? AND vr.facility_id = ? AND vr.visitor_user_id = ? AND vr.prisoner_id = ?
            AND vr.status = 'APPROVED' AND p.status = 'ACTIVE' AND p.visitation_status = 'APPROVED'
        )
        AND EXISTS (
          SELECT 1 FROM facilities f INNER JOIN visit_policies vp ON vp.facility_id = f.id
          WHERE f.id = ? AND f.current_state = 'NORMAL_OPERATIONS' AND f.timezone = ? AND vp.version = ?
        )
        AND EXISTS (SELECT 1 FROM credit_accounts ca WHERE ca.user_id = ? AND ca.facility_id = ? AND ca.available_credits >= 1)
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.visitor_user_id = ? AND a.status IN (${activePlaceholders})
            AND a.requested_start < ? AND a.requested_end > ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.facility_id = ? AND a.prisoner_id = ? AND a.status IN (${activePlaceholders})
            AND a.requested_start < ? AND a.requested_end > ?
        )`)
      .bind(
        input.appointmentId, input.facilityId, input.visitorUserId, input.prisonerId,
        input.requestedStart, input.requestedEnd, input.timezone, input.policyVersion,
        input.durationMinutes, input.appointmentType, input.now, input.now, input.correlationId,
        input.idempotency.claimId, input.idempotency.scope, input.idempotency.key,
        input.relationshipId, input.facilityId, input.visitorUserId, input.prisonerId,
        input.facilityId, input.timezone, input.policyVersion,
        input.visitorUserId, input.facilityId,
        input.visitorUserId, ...activeAppointmentStatuses, input.requestedEnd, input.requestedStart,
        input.facilityId, input.prisonerId, ...activeAppointmentStatuses, input.requestedEnd, input.requestedStart,
      ),
    d1.prepare(`INSERT INTO appointment_status_events
      (id, appointment_id, from_status, to_status, actor_user_id, reason_code, reason_text, correlation_id, created_at)
      SELECT ?, ?, NULL, 'SUBMITTED', ?, 'VISITOR_SUBMITTED', 'Visitor submitted an appointment request.', ?, ?
      WHERE ${transitionGuard.sql}`)
      .bind(crypto.randomUUID(), input.appointmentId, input.visitorUserId, input.correlationId, input.now, ...transitionGuard.values),
    ...auditAndOutboxStatements(d1, {
      actorUserId: input.visitorUserId,
      actorRole: "VISITOR",
      facilityId: input.facilityId,
      actionType: "APPOINTMENT_SUBMITTED",
      entityType: "appointment",
      entityId: input.appointmentId,
      reason: "Visitor submitted an appointment request.",
      newValues: { status: "SUBMITTED", requestedStart: input.requestedStart, requestedEnd: input.requestedEnd, prisonerId: input.prisonerId },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: "APPOINTMENT_SUBMITTED",
      payload: { appointmentId: input.appointmentId, visitorUserId: input.visitorUserId },
    }, transitionGuard),
    d1.prepare(`UPDATE idempotency_records
      SET status = 'COMPLETED', response_status = ?, response_body = ?, completed_at = ?
      WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'
        AND ${transitionGuard.sql}`)
      .bind(201, JSON.stringify(input.responseBody), input.now, input.idempotency.claimId, input.idempotency.scope, input.idempotency.key, ...transitionGuard.values),
  ];
}
