import { auditAndOutboxStatements, type DomainEventInput } from "./events";

export type IncidentCreateWrite = {
  id: string;
  facilityId: string;
  incidentType: string;
  severity: string;
  title: string;
  description: string;
  appointmentId: string | null;
  sessionId: string | null;
  resourceId: string | null;
  reporterUserId: string;
  idempotencyKey: string;
  requestHash: string;
  now: string;
  correlationId: string;
};

export function createIncidentStatements(d1: D1Database, input: IncidentCreateWrite, event: DomainEventInput): D1PreparedStatement[] {
  return [
    d1.prepare(`INSERT OR IGNORE INTO incidents
      (id, facility_id, incident_type, severity, status, title, description, appointment_id, session_id, resource_id, reporter_user_id, version, idempotency_key, request_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .bind(input.id, input.facilityId, input.incidentType, input.severity, input.title, input.description, input.appointmentId, input.sessionId, input.resourceId, input.reporterUserId, input.idempotencyKey, input.requestHash, input.now, input.now),
    d1.prepare(`INSERT INTO incident_events (id, incident_id, event_type, actor_user_id, details, correlation_id, created_at)
      SELECT ?, ?, 'CREATED', ?, ?, ?, ? WHERE changes() > 0`)
      .bind(crypto.randomUUID(), input.id, input.reporterUserId, input.description, input.correlationId, input.now),
    ...auditAndOutboxStatements(d1, event, { sql: "changes() > 0", values: [] }),
  ];
}

export type IncidentTransitionWrite = {
  incidentId: string;
  facilityId: string;
  expectedVersion: number;
  nextStatus: string;
  nextAssignee: string | null;
  resolution: string | null;
  actorUserId: string;
  command: string;
  details: string;
  now: string;
  correlationId: string;
};

export function transitionIncidentStatements(d1: D1Database, input: IncidentTransitionWrite, event: DomainEventInput): D1PreparedStatement[] {
  return [
    d1.prepare(`UPDATE incidents SET status = ?, assigned_user_id = ?, resolution = COALESCE(?, resolution), version = version + 1, updated_at = ?
      WHERE id = ? AND facility_id = ? AND version = ?`)
      .bind(input.nextStatus, input.nextAssignee, input.resolution, input.now, input.incidentId, input.facilityId, input.expectedVersion),
    d1.prepare(`INSERT INTO incident_events (id, incident_id, event_type, actor_user_id, details, correlation_id, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
      .bind(crypto.randomUUID(), input.incidentId, input.command.toUpperCase(), input.actorUserId, input.details, input.correlationId, input.now),
    ...auditAndOutboxStatements(d1, event, { sql: "changes() > 0", values: [] }),
  ];
}
