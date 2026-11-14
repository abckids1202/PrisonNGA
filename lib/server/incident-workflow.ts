import { auditAndOutboxStatements, type DomainEventInput } from "./events";

export type IncidentCreateWrite = {
  id: string;
  organizationId: string;
  facilityId: string;
  incidentType: string;
  severity: string;
  title: string;
  description: string;
  appointmentId: string | null;
  sessionId: string | null;
  resourceId: string | null;
  sourceSecurityEventId: string | null;
  reporterUserId: string;
  idempotencyKey: string;
  requestHash: string;
  now: string;
  correlationId: string;
};

export function createIncidentStatements(d1: D1Database, input: IncidentCreateWrite, event: DomainEventInput): D1PreparedStatement[] {
  return [
    d1.prepare(`INSERT OR IGNORE INTO incidents
      (id, organization_id, facility_id, incident_type, severity, status, title, description, appointment_id, session_id, resource_id, source_security_event_id, reporter_user_id, version, idempotency_key, request_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .bind(input.id, input.organizationId, input.facilityId, input.incidentType, input.severity, input.title, input.description, input.appointmentId, input.sessionId, input.resourceId, input.sourceSecurityEventId, input.reporterUserId, input.idempotencyKey, input.requestHash, input.now, input.now),
    d1.prepare(`INSERT INTO incident_events (id, organization_id, incident_id, event_type, actor_user_id, details, correlation_id, created_at)
      SELECT ?, ?, ?, 'CREATED', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM incidents WHERE id = ? AND organization_id = ? AND facility_id = ?)`)
      .bind(crypto.randomUUID(), input.organizationId, input.id, input.reporterUserId, input.description, input.correlationId, input.now, input.id, input.organizationId, input.facilityId),
    ...auditAndOutboxStatements(d1, event, { sql: "EXISTS (SELECT 1 FROM incidents WHERE id = ? AND organization_id = ? AND facility_id = ?)", values: [input.id, input.organizationId, input.facilityId] }),
  ];
}

export type IncidentTransitionWrite = {
  incidentId: string;
  organizationId: string;
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
    d1.prepare(`UPDATE incidents SET status = ?, assigned_user_id = ?, resolution = COALESCE(?, resolution), version = version + 1, last_transition_id = ?, updated_at = ?
      WHERE id = ? AND organization_id = ? AND facility_id = ? AND version = ?`)
      .bind(input.nextStatus, input.nextAssignee, input.resolution, input.correlationId, input.now, input.incidentId, input.organizationId, input.facilityId, input.expectedVersion),
    d1.prepare(`INSERT INTO incident_events (id, organization_id, incident_id, event_type, actor_user_id, details, correlation_id, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM incidents WHERE id = ? AND organization_id = ? AND facility_id = ? AND version = ? AND last_transition_id = ?)
        AND NOT EXISTS (SELECT 1 FROM incident_events WHERE incident_id = ? AND organization_id = ? AND correlation_id = ?)`)
      .bind(crypto.randomUUID(), input.organizationId, input.incidentId, input.command.toUpperCase(), input.actorUserId, input.details, input.correlationId, input.now, input.incidentId, input.organizationId, input.facilityId, input.expectedVersion + 1, input.correlationId, input.incidentId, input.organizationId, input.correlationId),
    ...auditAndOutboxStatements(d1, event, { sql: "EXISTS (SELECT 1 FROM incident_events WHERE incident_id = ? AND organization_id = ? AND correlation_id = ?) AND NOT EXISTS (SELECT 1 FROM outbox_events WHERE aggregate_type = 'incident' AND aggregate_id = ? AND event_type = ?)", values: [input.incidentId, input.organizationId, input.correlationId, input.incidentId, event.eventType] }),
  ];
}
