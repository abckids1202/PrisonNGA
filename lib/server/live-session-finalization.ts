import { consumeVisitCreditStatements } from "./credits";

export type FinalizeLiveSessionInput = {
  sessionId: string;
  appointmentId: string;
  facilityId: string;
  sessionVersion: number;
  sessionStatus: string;
  appointmentVersion: number;
  creditAccountId: string;
  actorUserId: string;
  actorRole: string;
  requestId: string;
  correlationId: string;
  now: string;
  reason: string;
  providerEvent: {
    id: string;
    eventType: string;
    participantRole: string | null;
    metadata: Record<string, unknown>;
  };
};

export function finalizeLiveSessionStatements(d1: D1Database, input: FinalizeLiveSessionInput): D1PreparedStatement[] {
  const reservationAvailable = `EXISTS (SELECT 1 FROM credit_accounts ca
      WHERE ca.id = ? AND ca.facility_id = ? AND ca.reserved_credits >= 1)
    AND EXISTS (SELECT 1 FROM credit_ledger_entries r
      WHERE r.credit_account_id = ? AND r.appointment_id = ? AND r.entry_type = 'RESERVATION')
    AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t
      WHERE t.appointment_id = ? AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))`;
  const reservationValues = [input.creditAccountId, input.facilityId, input.creditAccountId, input.appointmentId, input.appointmentId];
  const eventExists = `EXISTS (SELECT 1 FROM visit_session_events e
    WHERE e.id = ? AND e.session_id = ? AND e.event_type = ? AND e.source = 'LIVEKIT_WEBHOOK')`;
  const eventValues = [input.providerEvent.id, input.sessionId, input.providerEvent.eventType];
  const finalState = `EXISTS (SELECT 1 FROM visit_sessions vs
      INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
      WHERE vs.id = ? AND vs.facility_id = ? AND vs.appointment_id = ? AND vs.status = 'ENDED'
        AND vs.version = ? AND vs.actual_ended_at = ?
        AND a.status = 'COMPLETED' AND a.version = ?)`;
  const finalStateValues = [input.sessionId, input.facilityId, input.appointmentId, input.sessionVersion + 1, input.now,
    input.appointmentVersion + 1];

  const transitionGuard = {
    sql: `${finalState} AND ${reservationAvailable}`,
    values: [...finalStateValues, ...reservationValues],
  };

  return [
    d1.prepare(`INSERT OR IGNORE INTO visit_session_events
      (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
      SELECT ?, ?, ?, 'LIVEKIT_WEBHOOK', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM visit_sessions vs INNER JOIN appointments a
        ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
        WHERE vs.id = ? AND vs.facility_id = ? AND vs.appointment_id = ?
          AND vs.status = ? AND vs.version = ?
          AND a.status = 'IN_PROGRESS' AND a.version = ?)
        AND ${reservationAvailable}`)
      .bind(input.providerEvent.id, input.sessionId, input.providerEvent.eventType, input.providerEvent.participantRole,
        JSON.stringify(input.providerEvent.metadata), input.correlationId, input.now,
        input.sessionId, input.facilityId, input.appointmentId, input.sessionStatus, input.sessionVersion,
        input.appointmentVersion, ...reservationValues),
    d1.prepare(`UPDATE visit_sessions SET status = 'ENDED', actual_ended_at = ?, version = version + 1,
        updated_at = ?, termination_reason = NULL
      WHERE id = ? AND facility_id = ? AND appointment_id = ? AND status = ? AND version = ?
        AND ${eventExists}
        AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = ? AND a.facility_id = ?
          AND a.status = 'IN_PROGRESS' AND a.version = ?)
        AND ${reservationAvailable}`)
      .bind(input.now, input.now, input.sessionId, input.facilityId, input.appointmentId, input.sessionStatus,
        input.sessionVersion, ...eventValues, input.appointmentId, input.facilityId, input.appointmentVersion,
        ...reservationValues),
    d1.prepare(`UPDATE appointments SET status = 'COMPLETED', version = version + 1, updated_at = ?
      WHERE id = ? AND facility_id = ? AND status = 'IN_PROGRESS' AND version = ?
        AND EXISTS (SELECT 1 FROM visit_sessions vs WHERE vs.id = ? AND vs.facility_id = ?
          AND vs.appointment_id = ? AND vs.status = 'ENDED' AND vs.version = ? AND vs.actual_ended_at = ?)`)
      .bind(input.now, input.appointmentId, input.facilityId, input.appointmentVersion,
        input.sessionId, input.facilityId, input.appointmentId, input.sessionVersion + 1, input.now),
    d1.prepare(`UPDATE resource_reservations SET status = 'RELEASED'
      WHERE appointment_id = ? AND facility_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE')
        AND ${finalState}`)
      .bind(input.appointmentId, input.facilityId, ...finalStateValues),
    ...consumeVisitCreditStatements(d1, {
      accountId: input.creditAccountId,
      appointmentId: input.appointmentId,
      actorUserId: input.actorUserId,
      reason: input.reason,
      now: input.now,
      guard: transitionGuard,
    }),
    d1.prepare(`INSERT INTO audit_events
      (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason,
        old_values, new_values, correlation_id, request_id, created_at)
      SELECT ?, ?, ?, ?, 'VISIT_COMPLETED', 'visit_session', ?, ?, ?, ?, ?, ?, ?
      WHERE ${finalState}
        AND EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = 'CONSUMPTION')
        AND changes() = 1`)
      .bind(crypto.randomUUID(), input.actorUserId, input.actorRole, input.facilityId, input.sessionId, input.reason,
        JSON.stringify({ sessionStatus: input.sessionStatus, appointmentStatus: 'IN_PROGRESS', credit: 'RESERVED' }),
        JSON.stringify({ sessionStatus: 'ENDED', appointmentStatus: 'COMPLETED', credit: 'CONSUMED' }),
        input.correlationId, input.requestId, input.now, ...finalStateValues, input.appointmentId, input.creditAccountId),
    d1.prepare(`INSERT INTO outbox_events
      (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
      SELECT ?, 'VISIT_COMPLETED', 'visit_session', ?, ?, ?, ?, ?
      WHERE ${finalState}
        AND EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = 'CONSUMPTION')
        AND changes() = 1`)
      .bind(crypto.randomUUID(), input.sessionId, input.facilityId,
        JSON.stringify({ sessionId: input.sessionId, appointmentId: input.appointmentId, status: 'COMPLETED' }),
        input.correlationId, input.now, ...finalStateValues, input.appointmentId, input.creditAccountId),
  ];
}
