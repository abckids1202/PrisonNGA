import { auditAndOutboxStatements, type DomainEventInput } from "./events";

export async function legalHoldTargetExists(d1: D1Database, facilityId: string, entityType: string, entityId: string): Promise<boolean> {
  if (entityType === "verification_case") {
    return Boolean(await d1.prepare("SELECT 1 AS found FROM verification_cases WHERE id = ? AND facility_id = ?").bind(entityId, facilityId).first());
  }
  if (entityType === "evidence_document") {
    return Boolean(await d1.prepare("SELECT 1 AS found FROM evidence_documents WHERE id = ? AND facility_id = ?").bind(entityId, facilityId).first());
  }
  return false;
}

export type LegalHoldCreateWrite = {
  id: string;
  facilityId: string;
  entityType: string;
  entityId: string;
  reason: string;
  actorUserId: string;
  now: string;
};

export function createLegalHoldStatements(d1: D1Database, input: LegalHoldCreateWrite, event: DomainEventInput): D1PreparedStatement[] {
  return [
    d1.prepare(`INSERT INTO legal_holds (id, facility_id, entity_type, entity_id, reason, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`)
      .bind(input.id, input.facilityId, input.entityType, input.entityId, input.reason, input.actorUserId, input.now, input.now),
    d1.prepare(`UPDATE evidence_documents SET legal_hold = 1, updated_at = ? WHERE facility_id = ?
      AND ((? = 'verification_case' AND verification_case_id = ?) OR (? = 'evidence_document' AND id = ?))`)
      .bind(input.now, input.facilityId, input.entityType, input.entityId, input.entityType, input.entityId),
    ...auditAndOutboxStatements(d1, event, {
      sql: "EXISTS (SELECT 1 FROM legal_holds WHERE id = ? AND facility_id = ? AND status = 'ACTIVE')",
      values: [input.id, input.facilityId],
    }),
  ];
}

export type LegalHoldReleaseWrite = {
  id: string;
  facilityId: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  now: string;
};

export function releaseLegalHoldStatements(d1: D1Database, input: LegalHoldReleaseWrite, event: DomainEventInput): D1PreparedStatement[] {
  return [
    d1.prepare(`UPDATE legal_holds SET status = 'RELEASED', released_by = ?, released_at = ?, updated_at = ?
      WHERE id = ? AND facility_id = ? AND status = 'ACTIVE'`)
      .bind(input.actorUserId, input.now, input.now, input.id, input.facilityId),
    ...auditAndOutboxStatements(d1, event, { sql: "changes() > 0", values: [] }),
    d1.prepare(`UPDATE evidence_documents SET legal_hold = 0, updated_at = ? WHERE facility_id = ?
      AND ((? = 'verification_case' AND verification_case_id = ?) OR (? = 'evidence_document' AND id = ?))
      AND changes() > 0
      AND NOT EXISTS (SELECT 1 FROM legal_holds WHERE facility_id = ? AND entity_type = ? AND entity_id = ? AND status = 'ACTIVE')
      AND EXISTS (SELECT 1 FROM legal_holds WHERE id = ? AND facility_id = ? AND status = 'RELEASED')`)
      .bind(input.now, input.facilityId, input.entityType, input.entityId, input.entityType, input.entityId, input.facilityId, input.entityType, input.entityId, input.id, input.facilityId),
  ];
}
