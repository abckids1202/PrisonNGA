import { auditAndOutboxStatements } from "./events";

export type ResourceReassignmentStatementInput = {
  d1: D1Database;
  facilityId: string;
  appointmentId: string;
  sourceReservationId: string;
  sourceResourceId: string;
  sourceResourceType: "ROOM" | "DEVICE";
  sourceStatus: "HELD" | "RESERVED" | "ACTIVE";
  startsAt: string;
  endsAt: string;
  targetResourceId: string;
  expectedSourceVersion: number;
  expectedTargetVersion: number;
  expectedWaitingVersion: number;
  waitingExists: boolean;
  actorUserId: string;
  actorRole: string | null;
  reason: string;
  oldResourceName: string;
  newResourceName: string;
  requestId: string;
  correlationId: string;
  now: string;
};

export function resourceReassignmentStatements(input: ResourceReassignmentStatementInput): D1PreparedStatement[] {
  const { d1 } = input;
  const waitingAssignmentColumn = input.sourceResourceType === "ROOM" ? "assigned_room_id" : "assigned_kiosk_id";
  const targetStatus = input.sourceResourceType === "ROOM" ? "AVAILABLE" : "ONLINE";
  const reservationId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    d1.prepare(`INSERT INTO resource_reservations (id, facility_id, appointment_id, resource_type, resource_id, status, starts_at, ends_at, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM resources sr WHERE sr.id = ? AND sr.facility_id = ? AND sr.version = ?)
        AND EXISTS (SELECT 1 FROM resources tr WHERE tr.id = ? AND tr.facility_id = ? AND tr.resource_type = ? AND tr.version = ? AND tr.status = ? AND tr.health_state = 'HEALTHY')
        AND NOT EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.resource_id = ? AND rr.resource_type = ? AND rr.facility_id = ? AND rr.appointment_id <> ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?)
        AND (${input.waitingExists ? `EXISTS (SELECT 1 FROM waiting_room_sessions w WHERE w.appointment_id = ? AND w.facility_id = ? AND w.version = ? AND (${waitingAssignmentColumn} IS NULL OR ${waitingAssignmentColumn} = ?))` : "NOT EXISTS (SELECT 1 FROM waiting_room_sessions w0 WHERE w0.appointment_id = ? AND w0.facility_id = ?)"})`)
      .bind(reservationId, input.facilityId, input.appointmentId, input.sourceResourceType, input.targetResourceId, input.sourceStatus, input.startsAt, input.endsAt, input.now,
        input.sourceResourceId, input.facilityId, input.expectedSourceVersion, input.targetResourceId, input.facilityId, input.sourceResourceType, input.expectedTargetVersion, targetStatus,
        input.targetResourceId, input.sourceResourceType, input.facilityId, input.appointmentId, input.endsAt, input.startsAt,
        ...(input.waitingExists ? [input.appointmentId, input.facilityId, input.expectedWaitingVersion, input.sourceResourceId] : [input.appointmentId, input.facilityId])),
    d1.prepare(`UPDATE resource_reservations SET status = 'RELEASED'
      WHERE id = ? AND facility_id = ? AND appointment_id = ? AND resource_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE')
        AND EXISTS (SELECT 1 FROM resource_reservations WHERE id = ? AND facility_id = ? AND appointment_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE'))`)
      .bind(input.sourceReservationId, input.facilityId, input.appointmentId, input.sourceResourceId, reservationId, input.facilityId, input.appointmentId),
    d1.prepare(`UPDATE resources SET version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?
      AND EXISTS (SELECT 1 FROM resource_reservations WHERE id = ? AND facility_id = ? AND appointment_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE'))`)
      .bind(input.now, input.sourceResourceId, input.facilityId, input.expectedSourceVersion, reservationId, input.facilityId, input.appointmentId),
    d1.prepare(`UPDATE resources SET version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?
      AND EXISTS (SELECT 1 FROM resource_reservations WHERE id = ? AND facility_id = ? AND appointment_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE'))`)
      .bind(input.now, input.targetResourceId, input.facilityId, input.expectedTargetVersion, reservationId, input.facilityId, input.appointmentId),
  ];
  if (input.waitingExists) {
    statements.push(d1.prepare(`UPDATE waiting_room_sessions SET ${waitingAssignmentColumn} = ?, version = version + 1, updated_at = ?
      WHERE appointment_id = ? AND facility_id = ? AND version = ? AND (${waitingAssignmentColumn} IS NULL OR ${waitingAssignmentColumn} = ?)
        AND EXISTS (SELECT 1 FROM resource_reservations WHERE id = ? AND facility_id = ? AND appointment_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE'))`)
      .bind(input.targetResourceId, input.now, input.appointmentId, input.facilityId, input.expectedWaitingVersion, input.sourceResourceId, reservationId, input.facilityId, input.appointmentId));
  }
  statements.push(...auditAndOutboxStatements(d1, {
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    facilityId: input.facilityId,
    actionType: "RESOURCE_REASSIGNED",
    entityType: "appointment",
    entityId: input.appointmentId,
    reason: input.reason,
    oldValues: { resourceId: input.sourceResourceId, resourceType: input.sourceResourceType, resourceName: input.oldResourceName },
    newValues: { resourceId: input.targetResourceId, resourceType: input.sourceResourceType, resourceName: input.newResourceName },
    requestId: input.requestId,
    correlationId: input.correlationId,
    eventType: "RESOURCE_REASSIGNED",
    payload: { appointmentId: input.appointmentId, visitorUserId: null, resourceType: input.sourceResourceType, oldResourceId: input.sourceResourceId, newResourceId: input.targetResourceId, newResourceName: input.newResourceName },
  }, { sql: `EXISTS (SELECT 1 FROM resource_reservations WHERE facility_id = ? AND appointment_id = ? AND resource_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE')) AND NOT EXISTS (SELECT 1 FROM resource_reservations WHERE id = ? AND facility_id = ? AND appointment_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE'))`, values: [input.facilityId, input.appointmentId, input.targetResourceId, input.sourceReservationId, input.facilityId, input.appointmentId] }));
  return statements;
}

export function reassignmentReservationCreated(results: Array<{ meta?: { changes?: number } }>): boolean {
  return Boolean(results[0]?.meta?.changes);
}
