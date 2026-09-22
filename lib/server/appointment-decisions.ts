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
  creditAccountId?: string;
  approval?: {
    creditAccountId: string;
    startsAt: string;
    endsAt: string;
    policyVersion: number;
    facilityTimezone: string;
    durationMinutes: number;
    earliestStartAt: string;
    latestStartAt: string;
  };
};

export function appointmentDecisionStatements(d1: D1Database, input: AppointmentDecisionInput): D1PreparedStatement[] {
  const guard = {
    sql: "EXISTS (SELECT 1 FROM appointments WHERE id = ? AND facility_id = ? AND status = ? AND version = ? AND last_transition_id = ?)",
    values: [input.appointmentId, input.facilityId, input.toStatus, input.expectedVersion + 1, input.correlationId],
  };
  const approvalValues: unknown[] = [];
  const approvalPredicate = input.approval ? `
      AND (
        (EXISTS (SELECT 1 FROM credit_ledger_entries r WHERE r.appointment_id = ? AND r.credit_account_id = ? AND r.entry_type = 'RESERVATION'
          AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t WHERE t.appointment_id = ? AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION')))
          AND EXISTS (SELECT 1 FROM credit_accounts ca WHERE ca.id = ? AND ca.reserved_credits >= 1))
        OR (NOT EXISTS (SELECT 1 FROM credit_ledger_entries r WHERE r.appointment_id = ? AND r.entry_type = 'RESERVATION')
          AND EXISTS (SELECT 1 FROM credit_accounts ca WHERE ca.id = ? AND ca.available_credits >= 1))
      )
      AND (
        EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.appointment_id = ? AND rr.facility_id = ? AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE'))
        OR EXISTS (SELECT 1 FROM resources r WHERE r.facility_id = ? AND r.resource_type = 'ROOM' AND r.status = 'AVAILABLE'
          AND NOT EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.facility_id = ? AND rr.appointment_id <> ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?))
      )
      AND (
        EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.appointment_id = ? AND rr.facility_id = ? AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE'))
        OR EXISTS (SELECT 1 FROM resources r WHERE r.facility_id = ? AND r.resource_type = 'DEVICE' AND r.status = 'ONLINE'
          AND NOT EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.facility_id = ? AND rr.appointment_id <> ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?))
      )
      AND EXISTS (SELECT 1 FROM appointments a
        INNER JOIN prisoners p ON p.id = a.prisoner_id
        INNER JOIN facilities f ON f.id = a.facility_id
        INNER JOIN visit_policies vp ON vp.facility_id = f.id
        WHERE a.id = appointments.id AND a.facility_id = appointments.facility_id
          AND p.status = 'ACTIVE' AND p.visitation_status = 'APPROVED' AND f.current_state = 'NORMAL_OPERATIONS'
          AND vp.version = ? AND vp.version = appointments.policy_version
          AND f.timezone = ? AND appointments.timezone = f.timezone
          AND appointments.duration_minutes = ?
          AND appointments.requested_start = ? AND appointments.requested_end = ?
          AND appointments.requested_start >= ? AND appointments.requested_start <= ?
          AND appointments.duration_minutes >= vp.min_duration_minutes AND appointments.duration_minutes <= vp.max_duration_minutes
          AND appointments.duration_minutes % 15 = 0
          AND ABS((julianday(appointments.requested_end) - julianday(appointments.requested_start)) * 1440 - appointments.duration_minutes) < 0.01
          AND EXISTS (SELECT 1 FROM visitor_relationships vr WHERE vr.facility_id = a.facility_id AND vr.prisoner_id = a.prisoner_id AND vr.visitor_user_id = a.visitor_user_id AND vr.status = 'APPROVED'))
      AND NOT EXISTS (SELECT 1 FROM appointments conflicting
        WHERE conflicting.id <> appointments.id AND conflicting.facility_id = appointments.facility_id
          AND (conflicting.visitor_user_id = appointments.visitor_user_id OR conflicting.prisoner_id = appointments.prisoner_id)
          AND conflicting.status IN ('APPROVED', 'WAITING', 'IN_PROGRESS')
          AND conflicting.requested_start < appointments.requested_end
          AND conflicting.requested_end > appointments.requested_start)` : "";
  if (input.approval) {
    approvalValues.push(
      input.appointmentId, input.approval.creditAccountId, input.appointmentId, input.approval.creditAccountId,
      input.appointmentId, input.approval.creditAccountId,
      input.appointmentId, input.facilityId, input.facilityId, input.facilityId, input.appointmentId, input.approval.endsAt, input.approval.startsAt,
      input.appointmentId, input.facilityId, input.facilityId, input.facilityId, input.appointmentId, input.approval.endsAt, input.approval.startsAt,
      input.approval.policyVersion, input.approval.facilityTimezone, input.approval.durationMinutes,
      input.approval.startsAt, input.approval.endsAt, input.approval.earliestStartAt, input.approval.latestStartAt,
    );
  }

  const statements = [
    d1.prepare(`UPDATE appointments SET status = ?, version = version + 1, updated_at = ?, last_transition_id = ?
      WHERE id = ? AND facility_id = ? AND status = ? AND version = ?${approvalPredicate}`)
      .bind(input.toStatus, input.now, input.correlationId, input.appointmentId, input.facilityId, input.fromStatus, input.expectedVersion, ...approvalValues),
  ];

  if (input.approval) {
    const { creditAccountId, startsAt, endsAt } = input.approval;
    statements.push(
      d1.prepare(`INSERT INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
        SELECT ?, ?, ?, 'RESERVATION', -1, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM appointments WHERE id = ? AND facility_id = ? AND last_transition_id = ?)
          AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type = 'RESERVATION')
          AND EXISTS (SELECT 1 FROM credit_accounts WHERE id = ? AND available_credits >= 1)`)
        .bind(crypto.randomUUID(), creditAccountId, input.appointmentId, `${input.appointmentId}:reservation`, input.reason, input.actorUserId, input.now, input.appointmentId, input.facilityId, input.correlationId, input.appointmentId, creditAccountId),
      d1.prepare(`UPDATE credit_accounts SET available_credits = available_credits - 1, reserved_credits = reserved_credits + 1, version = version + 1, updated_at = ? WHERE id = ? AND changes() = 1`)
        .bind(input.now, creditAccountId),
      reservationInsertStatement(d1, { facilityId: input.facilityId, appointmentId: input.appointmentId, resourceType: "ROOM", availableStatus: "AVAILABLE", startsAt, endsAt, now: input.now, correlationId: input.correlationId }),
      reservationInsertStatement(d1, { facilityId: input.facilityId, appointmentId: input.appointmentId, resourceType: "DEVICE", availableStatus: "ONLINE", startsAt, endsAt, now: input.now, correlationId: input.correlationId }),
    );
  } else if ((input.command === "reject" || input.command === "cancel") && input.creditAccountId) {
    statements.push(
      d1.prepare(`INSERT OR IGNORE INTO credit_ledger_entries (id, credit_account_id, appointment_id, entry_type, amount, idempotency_key, reason, created_by, created_at)
        SELECT ?, ?, ?, 'RESERVATION_RELEASE', 1, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM appointments WHERE id = ? AND facility_id = ? AND last_transition_id = ?)
          AND EXISTS (SELECT 1 FROM credit_accounts WHERE id = ? AND reserved_credits >= 1)
          AND EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = 'RESERVATION')
          AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries WHERE appointment_id = ? AND entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))`)
        .bind(crypto.randomUUID(), input.creditAccountId, input.appointmentId, `${input.appointmentId}:reservation-release`, input.reason, input.actorUserId, input.now,
          input.appointmentId, input.facilityId, input.correlationId, input.creditAccountId, input.appointmentId, input.creditAccountId, input.appointmentId),
      d1.prepare(`UPDATE credit_accounts SET available_credits = available_credits + 1, reserved_credits = reserved_credits - 1, version = version + 1, updated_at = ?
        WHERE id = ? AND changes() = 1`)
        .bind(input.now, input.creditAccountId),
    );
  }

  if (input.command === "reject" || input.command === "cancel") {
    statements.push(d1.prepare(`UPDATE resource_reservations SET status = 'RELEASED'
      WHERE appointment_id = ? AND facility_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE')
        AND EXISTS (SELECT 1 FROM appointments WHERE id = ? AND facility_id = ? AND last_transition_id = ?)`)
      .bind(input.appointmentId, input.facilityId, input.appointmentId, input.facilityId, input.correlationId));
  }

  statements.push(
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
  );
  return statements;
}

function reservationInsertStatement(
  d1: D1Database,
  input: { facilityId: string; appointmentId: string; resourceType: "ROOM" | "DEVICE"; availableStatus: "AVAILABLE" | "ONLINE"; startsAt: string; endsAt: string; now: string; correlationId: string },
): D1PreparedStatement {
  return d1.prepare(`INSERT INTO resource_reservations (id, facility_id, appointment_id, resource_type, resource_id, status, starts_at, ends_at, created_at)
    SELECT ?, ?, ?, ?, (SELECT r.id FROM resources r WHERE r.facility_id = ? AND r.resource_type = ? AND r.status = ?
      AND NOT EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.facility_id = ? AND rr.appointment_id <> ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?)
      ORDER BY r.display_name ASC LIMIT 1), 'RESERVED', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM appointments WHERE id = ? AND facility_id = ? AND last_transition_id = ?)
      AND NOT EXISTS (SELECT 1 FROM resource_reservations WHERE appointment_id = ? AND facility_id = ? AND resource_type = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE'))`)
    .bind(crypto.randomUUID(), input.facilityId, input.appointmentId, input.resourceType, input.facilityId, input.resourceType, input.availableStatus,
      input.facilityId, input.appointmentId, input.endsAt, input.startsAt, input.startsAt, input.endsAt, input.now,
      input.appointmentId, input.facilityId, input.correlationId, input.appointmentId, input.facilityId, input.resourceType);
}
