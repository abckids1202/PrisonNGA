import { auditAndOutboxStatements } from "./events";

export type ExpiredEvidenceRetentionInput = {
  id: string;
  facilityId: string;
  storageKey: string;
  retentionUntil: string;
  requestId: string;
  correlationId: string;
  now: string;
};

export function expiredEvidenceRetentionStatements(d1: D1Database, input: ExpiredEvidenceRetentionInput): D1PreparedStatement[] {
  return [
    d1.prepare(`UPDATE evidence_documents
      SET status = 'DELETED', deleted_at = ?, updated_at = ?
      WHERE id = ? AND facility_id = ? AND status = 'AVAILABLE' AND legal_hold = 0 AND retention_until <= ?`)
      .bind(input.now, input.now, input.id, input.facilityId, input.now),
    ...auditAndOutboxStatements(d1, {
      actorUserId: "system:retention",
      actorRole: "SYSTEM",
      facilityId: input.facilityId,
      actionType: "EVIDENCE_RETENTION_DELETED",
      entityType: "evidence_document",
      entityId: input.id,
      reason: "Evidence reached its retention deadline and had no active legal hold.",
      oldValues: { status: "AVAILABLE", retentionUntil: input.retentionUntil, storageKey: input.storageKey },
      newValues: { status: "DELETED", deletedAt: input.now },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: "EVIDENCE_RETENTION_DELETED",
      payload: { evidenceId: input.id },
    }, { sql: "changes() > 0", values: [] }),
  ];
}
