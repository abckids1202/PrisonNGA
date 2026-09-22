import { consumeVisitCreditStatements, releaseVisitCreditStatements } from "./credits";
import { auditAndOutboxStatements } from "./events";

export type FinalizeLiveSessionInput = {
  sessionId: string;
  appointmentId: string;
  facilityId: string;
  sessionVersion: number;
  sessionStatus: string;
  finalSessionStatus: "ENDED" | "TERMINATED";
  appointmentVersion: number;
  finalAppointmentStatus: "COMPLETED" | "TECHNICAL_FAILURE";
  creditAccountId: string;
  creditOutcome: "CONSUME" | "RELEASE";
  actorUserId: string;
  actorRole: string;
  requestId: string;
  correlationId: string;
  now: string;
  reason: string;
  event: {
    id: string;
    eventType: string;
    source: "LIVEKIT_WEBHOOK" | "STAFF" | "SECUREVISIT_SCHEDULER";
    participantRole: string | null;
    metadata: Record<string, unknown>;
  };
};

export type RequestLiveSessionEndInput = {
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
  mode: "normal" | "terminate";
};

export function getExpiredSessionDisposition(input: { actual_started_at: string | null; termination_reason: string | null }) {
  const terminationRequested = input.termination_reason?.startsWith("STAFF_TERMINATE:") || false;
  const terminationReason = terminationRequested ? input.termination_reason!.slice("STAFF_TERMINATE:".length) : null;
  if (terminationRequested || !input.actual_started_at) {
    return {
      terminationRequested,
      finalSessionStatus: "TERMINATED" as const,
      finalAppointmentStatus: "TECHNICAL_FAILURE" as const,
      creditOutcome: "RELEASE" as const,
      eventType: terminationRequested ? "SESSION_TERMINATED" as const : "SESSION_ABANDONED" as const,
      reason: terminationReason || "Live-session window expired before the visit started.",
    };
  }
  return {
    terminationRequested: false,
    finalSessionStatus: "ENDED" as const,
    finalAppointmentStatus: "COMPLETED" as const,
    creditOutcome: "CONSUME" as const,
    eventType: "SESSION_EXPIRED" as const,
    reason: "Authorized live-session window expired.",
  };
}

export function requestLiveSessionEndStatements(d1: D1Database, input: RequestLiveSessionEndInput): D1PreparedStatement[] {
  const terminationReason = input.mode === "terminate" ? `STAFF_TERMINATE:${input.reason}` : null;
  const activeReservation = `EXISTS (SELECT 1 FROM credit_accounts ca
      WHERE ca.id = ? AND ca.facility_id = ? AND ca.reserved_credits >= 1)
    AND EXISTS (SELECT 1 FROM credit_ledger_entries r
      WHERE r.credit_account_id = ? AND r.appointment_id = ? AND r.entry_type = 'RESERVATION')
    AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t
      WHERE t.appointment_id = ? AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))`;
  const reservationValues = [input.creditAccountId, input.facilityId, input.creditAccountId, input.appointmentId, input.appointmentId];
  const endingState = `EXISTS (SELECT 1 FROM visit_sessions vs INNER JOIN appointments a
      ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
      WHERE vs.id = ? AND vs.facility_id = ? AND vs.appointment_id = ? AND vs.status = 'ENDING'
        AND vs.version = ? AND vs.termination_reason IS ?
        AND a.status = 'IN_PROGRESS' AND a.version = ?)
    AND ${activeReservation}`;
  const endingStateValues = [input.sessionId, input.facilityId, input.appointmentId, input.sessionVersion + 1,
    terminationReason, input.appointmentVersion, ...reservationValues];
  const guard = { sql: endingState, values: endingStateValues };

  return [
    d1.prepare(`UPDATE visit_sessions SET status = 'ENDING', termination_reason = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND facility_id = ? AND appointment_id = ? AND status = ? AND version = ?
        AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = ? AND a.facility_id = ?
          AND a.status = 'IN_PROGRESS' AND a.version = ?)
        AND ${activeReservation}`)
      .bind(terminationReason, input.now, input.sessionId, input.facilityId, input.appointmentId,
        input.sessionStatus, input.sessionVersion, input.appointmentId, input.facilityId, input.appointmentVersion,
        ...reservationValues),
    d1.prepare(`INSERT INTO visit_session_events
      (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
      SELECT ?, ?, 'SESSION_END_REQUESTED', 'STAFF', 'FACILITY', ?, ?, ? WHERE ${endingState}`)
      .bind(crypto.randomUUID(), input.sessionId, JSON.stringify({ mode: input.mode, reason: input.reason }), input.correlationId, input.now, ...endingStateValues),
    ...auditAndOutboxStatements(d1, {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      facilityId: input.facilityId,
      actionType: "VISIT_END_REQUESTED",
      entityType: "visit_session",
      entityId: input.sessionId,
      reason: input.reason,
      oldValues: { status: input.sessionStatus, version: input.sessionVersion },
      newValues: { status: "ENDING", version: input.sessionVersion + 1, mode: input.mode },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: "VISIT_END_REQUESTED",
      payload: { sessionId: input.sessionId, appointmentId: input.appointmentId, mode: input.mode },
    }, guard),
  ];
}

export function finalizeLiveSessionStatements(d1: D1Database, input: FinalizeLiveSessionInput): D1PreparedStatement[] {
  const reservationAvailable = `EXISTS (SELECT 1 FROM credit_accounts ca
      WHERE ca.id = ? AND ca.facility_id = ? AND ca.reserved_credits >= 1)
    AND EXISTS (SELECT 1 FROM credit_ledger_entries r
      WHERE r.credit_account_id = ? AND r.appointment_id = ? AND r.entry_type = 'RESERVATION')
    AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t
      WHERE t.appointment_id = ? AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))`;
  const reservationValues = [input.creditAccountId, input.facilityId, input.creditAccountId, input.appointmentId, input.appointmentId];
  const eventExists = `EXISTS (SELECT 1 FROM visit_session_events e
    WHERE e.id = ? AND e.session_id = ? AND e.event_type = ? AND e.source = ?)`;
  const eventValues = [input.event.id, input.sessionId, input.event.eventType, input.event.source];
  const finalState = `EXISTS (SELECT 1 FROM visit_sessions vs
      INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
      WHERE vs.id = ? AND vs.facility_id = ? AND vs.appointment_id = ? AND vs.status = '${input.finalSessionStatus}'
        AND vs.version = ? AND vs.actual_ended_at = ?
        AND a.status = '${input.finalAppointmentStatus}' AND a.version = ?)`;
  const finalStateValues = [input.sessionId, input.facilityId, input.appointmentId, input.sessionVersion + 1, input.now,
    input.appointmentVersion + 1];

  const transitionGuard = {
    sql: `${finalState} AND ${reservationAvailable}`,
    values: [...finalStateValues, ...reservationValues],
  };

  return [
    d1.prepare(`INSERT OR IGNORE INTO visit_session_events
      (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM visit_sessions vs INNER JOIN appointments a
        ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
        WHERE vs.id = ? AND vs.facility_id = ? AND vs.appointment_id = ?
          AND vs.status = ? AND vs.version = ?
          AND a.status = 'IN_PROGRESS' AND a.version = ?)
        AND ${reservationAvailable}`)
      .bind(input.event.id, input.sessionId, input.event.eventType, input.event.source, input.event.participantRole,
        JSON.stringify(input.event.metadata), input.correlationId, input.now,
        input.sessionId, input.facilityId, input.appointmentId, input.sessionStatus, input.sessionVersion,
        input.appointmentVersion, ...reservationValues),
    d1.prepare(`UPDATE visit_sessions SET status = '${input.finalSessionStatus}', actual_ended_at = ?, version = version + 1,
        updated_at = ?, termination_reason = ?
      WHERE id = ? AND facility_id = ? AND appointment_id = ? AND status = ? AND version = ?
        AND ${eventExists}
        AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = ? AND a.facility_id = ?
          AND a.status = 'IN_PROGRESS' AND a.version = ?)
        AND ${reservationAvailable}`)
      .bind(input.now, input.now, input.creditOutcome === "RELEASE" ? input.reason : null, input.sessionId, input.facilityId, input.appointmentId, input.sessionStatus,
        input.sessionVersion, ...eventValues, input.appointmentId, input.facilityId, input.appointmentVersion,
        ...reservationValues),
    d1.prepare(`UPDATE appointments SET status = '${input.finalAppointmentStatus}', version = version + 1, updated_at = ?
      WHERE id = ? AND facility_id = ? AND status = 'IN_PROGRESS' AND version = ?
        AND EXISTS (SELECT 1 FROM visit_sessions vs WHERE vs.id = ? AND vs.facility_id = ?
          AND vs.appointment_id = ? AND vs.status = '${input.finalSessionStatus}' AND vs.version = ? AND vs.actual_ended_at = ?)`)
      .bind(input.now, input.appointmentId, input.facilityId, input.appointmentVersion,
        input.sessionId, input.facilityId, input.appointmentId, input.sessionVersion + 1, input.now),
    d1.prepare(`UPDATE resource_reservations SET status = 'RELEASED'
      WHERE appointment_id = ? AND facility_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE')
        AND ${finalState}`)
      .bind(input.appointmentId, input.facilityId, ...finalStateValues),
    ...(input.creditOutcome === "CONSUME" ? consumeVisitCreditStatements : releaseVisitCreditStatements)(d1, {
      accountId: input.creditAccountId,
      appointmentId: input.appointmentId,
      actorUserId: input.actorUserId,
      reason: input.reason,
      now: input.now,
      guard: transitionGuard,
    }),
    ...auditAndOutboxStatements(d1, {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      facilityId: input.facilityId,
      actionType: input.finalAppointmentStatus === "COMPLETED" ? "VISIT_COMPLETED" : "VISIT_TERMINATED",
      entityType: "visit_session",
      entityId: input.sessionId,
      reason: input.reason,
      oldValues: { sessionStatus: input.sessionStatus, appointmentStatus: "IN_PROGRESS", credit: "RESERVED" },
      newValues: { sessionStatus: input.finalSessionStatus, appointmentStatus: input.finalAppointmentStatus, credit: input.creditOutcome === "CONSUME" ? "CONSUMED" : "RELEASED" },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: input.finalAppointmentStatus === "COMPLETED" ? "VISIT_COMPLETED" : "VISIT_TERMINATED",
      payload: { sessionId: input.sessionId, appointmentId: input.appointmentId, status: input.finalAppointmentStatus },
    }, {
      sql: `${finalState}
        AND EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = '${input.creditOutcome === "CONSUME" ? "CONSUMPTION" : "RESERVATION_RELEASE"}')
        AND changes() = 1`,
      values: [...finalStateValues, input.appointmentId, input.creditAccountId],
    }),
    d1.prepare(`UPDATE waiting_room_sessions SET state = ?, version = version + 1, updated_at = ?
      WHERE appointment_id = ? AND facility_id = ? AND state NOT IN ('COMPLETED', 'CANCELLED') AND ${finalState}`)
      .bind(input.finalAppointmentStatus === "COMPLETED" ? "COMPLETED" : "CANCELLED", input.now,
        input.appointmentId, input.facilityId, ...finalStateValues),
  ];
}
