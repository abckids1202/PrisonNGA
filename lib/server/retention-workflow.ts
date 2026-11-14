import { auditAndOutboxStatements } from "./events";

export type ExpiredEvidenceRetentionInput = {
  id: string;
  facilityId: string;
  storageKey: string;
  retentionUntil: string;
  requestId: string;
  correlationId: string;
  now: string;
  claimed?: boolean;
};

export function expiredEvidenceRetentionStatements(d1: D1Database, input: ExpiredEvidenceRetentionInput): D1PreparedStatement[] {
  const expectedStatus = input.claimed ? "PENDING_DELETION" : "AVAILABLE";
  return [
    d1.prepare(`UPDATE evidence_documents
      SET status = 'DELETED', deleted_at = ?, updated_at = ?
      WHERE id = ? AND facility_id = ? AND status = ? AND legal_hold = 0 AND retention_until <= ?`)
      .bind(input.now, input.now, input.id, input.facilityId, expectedStatus, input.now),
    ...auditAndOutboxStatements(d1, {
      actorUserId: "system:retention",
      actorRole: "SYSTEM",
      facilityId: input.facilityId,
      actionType: "EVIDENCE_RETENTION_DELETED",
      entityType: "evidence_document",
      entityId: input.id,
      reason: "Evidence reached its retention deadline and had no active legal hold.",
      oldValues: { status: expectedStatus, retentionUntil: input.retentionUntil, storageKey: input.storageKey },
      newValues: { status: "DELETED", deletedAt: input.now },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: "EVIDENCE_RETENTION_DELETED",
      payload: { evidenceId: input.id },
    }, { sql: "EXISTS (SELECT 1 FROM evidence_documents WHERE id = ? AND facility_id = ? AND status = 'DELETED' AND deleted_at = ?) AND NOT EXISTS (SELECT 1 FROM outbox_events WHERE facility_id = ? AND correlation_id = ? AND event_type = 'EVIDENCE_RETENTION_DELETED')", values: [input.id, input.facilityId, input.now, input.facilityId, input.correlationId] }),
  ];
}

export function claimExpiredEvidenceRetentionStatement(d1: D1Database, input: Pick<ExpiredEvidenceRetentionInput, "id" | "facilityId" | "now">): D1PreparedStatement {
  return d1.prepare(`UPDATE evidence_documents
    SET status = 'PENDING_DELETION', updated_at = ?
    WHERE id = ? AND facility_id = ? AND status IN ('AVAILABLE', 'QUARANTINED') AND legal_hold = 0 AND retention_until <= ?`)
    .bind(input.now, input.id, input.facilityId, input.now);
}

export function restoreClaimedEvidenceRetentionStatement(d1: D1Database, input: Pick<ExpiredEvidenceRetentionInput, "id" | "facilityId" | "now">): D1PreparedStatement {
  return d1.prepare(`UPDATE evidence_documents
    SET status = CASE WHEN scan_status = 'PENDING' THEN 'QUARANTINED' ELSE 'AVAILABLE' END, updated_at = ?
    WHERE id = ? AND facility_id = ? AND status = 'PENDING_DELETION'`)
    .bind(input.now, input.id, input.facilityId);
}

export type ExpiredRecordingRetentionInput = {
  id: string;
  facilityId: string;
  storageKey: string;
  retentionUntil: string;
  requestId: string;
  correlationId: string;
  now: string;
  claimed?: boolean;
};

export function claimExpiredRecordingRetentionStatement(d1: D1Database, input: Pick<ExpiredRecordingRetentionInput, "id" | "facilityId" | "now">): D1PreparedStatement {
  return d1.prepare(`UPDATE recordings
    SET status = 'PENDING_DELETION', updated_at = ?, version = version + 1
    WHERE id = ? AND facility_id = ? AND status IN ('AVAILABLE', 'LEGAL_HOLD') AND legal_hold = 0 AND retention_until <= ?`)
    .bind(input.now, input.id, input.facilityId, input.now);
}

export function restoreClaimedRecordingRetentionStatement(d1: D1Database, input: Pick<ExpiredRecordingRetentionInput, "id" | "facilityId" | "now">): D1PreparedStatement {
  return d1.prepare(`UPDATE recordings
    SET status = 'AVAILABLE', updated_at = ?, version = version + 1
    WHERE id = ? AND facility_id = ? AND status = 'PENDING_DELETION' AND legal_hold = 0`)
    .bind(input.now, input.id, input.facilityId);
}

export function expiredRecordingRetentionStatements(d1: D1Database, input: ExpiredRecordingRetentionInput): D1PreparedStatement[] {
  return [
    d1.prepare(`UPDATE recordings
      SET status = 'DELETED', storage_key = NULL, byte_size = NULL, updated_at = ?, version = version + 1
      WHERE id = ? AND facility_id = ? AND status = 'PENDING_DELETION' AND legal_hold = 0 AND retention_until <= ?`)
      .bind(input.now, input.id, input.facilityId, input.now),
    ...auditAndOutboxStatements(d1, {
      actorUserId: "system:retention",
      actorRole: "SYSTEM",
      facilityId: input.facilityId,
      actionType: "RECORDING_RETENTION_DELETED",
      entityType: "recording",
      entityId: input.id,
      reason: "Recording reached its retention deadline and had no active legal hold.",
      oldValues: { status: "PENDING_DELETION", retentionUntil: input.retentionUntil, storageKey: input.storageKey },
      newValues: { status: "DELETED", deletedAt: input.now },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: "RECORDING_RETENTION_DELETED",
      payload: { recordingId: input.id },
    }, { sql: "EXISTS (SELECT 1 FROM recordings WHERE id = ? AND facility_id = ? AND status = 'DELETED' AND storage_key IS NULL) AND NOT EXISTS (SELECT 1 FROM outbox_events WHERE facility_id = ? AND correlation_id = ? AND event_type = 'RECORDING_RETENTION_DELETED')", values: [input.id, input.facilityId, input.facilityId, input.correlationId] }),
  ];
}
