import { auditAndOutboxStatements, type DomainEventInput } from "./events";

export async function legalHoldTargetExists(d1: D1Database, organizationId: string, facilityId: string, entityType: string, entityId: string): Promise<boolean> {
  const facilityScope = "EXISTS (SELECT 1 FROM facilities f WHERE f.id = ? AND f.organization_id = ?)";
  if (entityType === "verification_case") {
    return Boolean(await d1.prepare(`SELECT 1 AS found FROM verification_cases WHERE id = ? AND facility_id = ? AND ${facilityScope}`).bind(entityId, facilityId, facilityId, organizationId).first());
  }
  if (entityType === "evidence_document") {
    return Boolean(await d1.prepare(`SELECT 1 AS found FROM evidence_documents WHERE id = ? AND facility_id = ? AND ${facilityScope}`).bind(entityId, facilityId, facilityId, organizationId).first());
  }
  if (entityType === "recording") {
    return Boolean(await d1.prepare("SELECT 1 AS found FROM recordings WHERE id = ? AND organization_id = ? AND facility_id = ?").bind(entityId, organizationId, facilityId).first());
  }
  return false;
}

export type LegalHoldCreateWrite = {
  id: string;
  organizationId: string;
  facilityId: string;
  entityType: string;
  entityId: string;
  reason: string;
  actorUserId: string;
  now: string;
};

export function createLegalHoldStatements(d1: D1Database, input: LegalHoldCreateWrite, event: DomainEventInput): D1PreparedStatement[] {
  if (input.entityType === "recording") {
    return [
      d1.prepare(`INSERT INTO legal_holds (id, organization_id, facility_id, entity_type, entity_id, reason, status, created_by, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM recordings WHERE id = ? AND organization_id = ? AND facility_id = ? AND status = 'PENDING_DELETION')`)
        .bind(input.id, input.organizationId, input.facilityId, input.entityType, input.entityId, input.reason, input.actorUserId, input.now, input.now, input.entityId, input.organizationId, input.facilityId),
      d1.prepare(`UPDATE recordings SET legal_hold = 1, updated_at = ?
        WHERE id = ? AND organization_id = ? AND facility_id = ? AND status <> 'PENDING_DELETION'`)
        .bind(input.now, input.entityId, input.organizationId, input.facilityId),
      ...auditAndOutboxStatements(d1, event, {
        sql: "EXISTS (SELECT 1 FROM legal_holds WHERE id = ? AND organization_id = ? AND facility_id = ? AND status = 'ACTIVE')",
        values: [input.id, input.organizationId, input.facilityId],
      }),
    ];
  }
  return [
      d1.prepare(`INSERT INTO legal_holds (id, organization_id, facility_id, entity_type, entity_id, reason, status, created_by, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM evidence_documents
        WHERE organization_id = ? AND facility_id = ? AND status = 'PENDING_DELETION'
          AND ((? = 'verification_case' AND verification_case_id = ?) OR (? = 'evidence_document' AND id = ?))
      )`)
      .bind(input.id, input.organizationId, input.facilityId, input.entityType, input.entityId, input.reason, input.actorUserId, input.now, input.now, input.organizationId, input.facilityId, input.entityType, input.entityId, input.entityType, input.entityId),
    d1.prepare(`UPDATE evidence_documents SET legal_hold = 1, updated_at = ? WHERE organization_id = ? AND facility_id = ? AND status <> 'PENDING_DELETION'
      AND ((? = 'verification_case' AND verification_case_id = ?) OR (? = 'evidence_document' AND id = ?))`)
      .bind(input.now, input.organizationId, input.facilityId, input.entityType, input.entityId, input.entityType, input.entityId),
    ...auditAndOutboxStatements(d1, event, {
      sql: "EXISTS (SELECT 1 FROM legal_holds WHERE id = ? AND organization_id = ? AND facility_id = ? AND status = 'ACTIVE')",
      values: [input.id, input.organizationId, input.facilityId],
    }),
  ];
}

export type LegalHoldReleaseWrite = {
  id: string;
  organizationId: string;
  facilityId: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  now: string;
};

export function releaseLegalHoldStatements(d1: D1Database, input: LegalHoldReleaseWrite, event: DomainEventInput): D1PreparedStatement[] {
  if (input.entityType === "recording") {
    return [
      d1.prepare(`UPDATE legal_holds SET status = 'RELEASED', released_by = ?, released_at = ?, updated_at = ?
        WHERE id = ? AND organization_id = ? AND facility_id = ? AND status = 'ACTIVE'`)
        .bind(input.actorUserId, input.now, input.now, input.id, input.organizationId, input.facilityId),
      ...auditAndOutboxStatements(d1, event, { sql: "changes() > 0", values: [] }),
      d1.prepare(`UPDATE recordings SET legal_hold = 0, updated_at = ?
        WHERE id = ? AND organization_id = ? AND facility_id = ?
        AND NOT EXISTS (SELECT 1 FROM legal_holds WHERE organization_id = ? AND facility_id = ? AND entity_type = 'recording' AND entity_id = ? AND status = 'ACTIVE')
        AND EXISTS (SELECT 1 FROM legal_holds WHERE id = ? AND organization_id = ? AND facility_id = ? AND status = 'RELEASED')`)
        .bind(input.now, input.entityId, input.organizationId, input.facilityId, input.organizationId, input.facilityId, input.entityId, input.id, input.organizationId, input.facilityId),
    ];
  }
  return [
    d1.prepare(`UPDATE legal_holds SET status = 'RELEASED', released_by = ?, released_at = ?, updated_at = ?
      WHERE id = ? AND organization_id = ? AND facility_id = ? AND status = 'ACTIVE'`)
      .bind(input.actorUserId, input.now, input.now, input.id, input.organizationId, input.facilityId),
    ...auditAndOutboxStatements(d1, event, { sql: "changes() > 0", values: [] }),
    d1.prepare(`UPDATE evidence_documents SET legal_hold = 0, updated_at = ? WHERE organization_id = ? AND facility_id = ?
      AND ((? = 'verification_case' AND verification_case_id = ?) OR (? = 'evidence_document' AND id = ?))
      AND changes() > 0
      AND NOT EXISTS (SELECT 1 FROM legal_holds WHERE organization_id = ? AND facility_id = ? AND entity_type = ? AND entity_id = ? AND status = 'ACTIVE')
      AND EXISTS (SELECT 1 FROM legal_holds WHERE id = ? AND organization_id = ? AND facility_id = ? AND status = 'RELEASED')`)
      .bind(input.now, input.organizationId, input.facilityId, input.entityType, input.entityId, input.entityType, input.entityId, input.organizationId, input.facilityId, input.entityType, input.entityId, input.id, input.organizationId, input.facilityId),
  ];
}
