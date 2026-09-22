import { auditAndOutboxStatements } from "./events";

export type VerificationDecisionInput = {
  verificationCaseId: string;
  relationshipId: string;
  facilityId: string;
  fromStatus: string;
  toStatus: string;
  expectedCaseVersion: number;
  fromRelationshipStatus: string;
  expectedRelationshipVersion: number;
  relationshipStatus: string;
  evidenceRequired: boolean;
  actorUserId: string;
  actorRole: string;
  reason: string;
  requestId: string;
  correlationId: string;
  now: string;
};

export function verificationDecisionStatements(d1: D1Database, input: VerificationDecisionInput): D1PreparedStatement[] {
  const caseTransition = {
    sql: "EXISTS (SELECT 1 FROM verification_cases vc WHERE vc.id = ? AND vc.facility_id = ? AND vc.status = ? AND vc.version = ? AND vc.reviewed_by = ? AND vc.reviewed_at = ?)",
    values: [input.verificationCaseId, input.facilityId, input.toStatus, input.expectedCaseVersion + 1, input.actorUserId, input.now],
  };
  const relationshipTransition = {
    sql: "EXISTS (SELECT 1 FROM visitor_relationships vr WHERE vr.id = ? AND vr.facility_id = ? AND vr.status = ? AND vr.version = ? AND vr.reviewed_by = ? AND vr.reviewed_at = ?)",
    values: [input.relationshipId, input.facilityId, input.relationshipStatus, input.expectedRelationshipVersion + 1, input.actorUserId, input.now],
  };
  const completedTransition = { sql: `${caseTransition.sql} AND ${relationshipTransition.sql}`, values: [...caseTransition.values, ...relationshipTransition.values] };
  return [
    d1.prepare(`UPDATE verification_cases SET status = ?, reviewed_by = ?, reviewed_at = ?, review_reason = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND facility_id = ? AND status = ? AND version = ?
        AND EXISTS (SELECT 1 FROM visitor_relationships vr WHERE vr.id = ? AND vr.facility_id = ? AND vr.status = ? AND vr.version = ?)
        AND (? = 0 OR ? <> 'APPROVED' OR evidence_required = 0
          OR EXISTS (SELECT 1 FROM evidence_documents ed WHERE ed.verification_case_id = verification_cases.id AND ed.facility_id = verification_cases.facility_id AND ed.status = 'AVAILABLE'))`)
      .bind(input.toStatus, input.actorUserId, input.now, input.reason, input.now,
        input.verificationCaseId, input.facilityId, input.fromStatus, input.expectedCaseVersion,
        input.relationshipId, input.facilityId, input.fromRelationshipStatus, input.expectedRelationshipVersion,
        input.evidenceRequired ? 1 : 0, input.toStatus),
    d1.prepare(`UPDATE visitor_relationships SET status = ?, reviewed_by = ?, reviewed_at = ?, review_reason = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND facility_id = ? AND status = ? AND version = ? AND ${caseTransition.sql}`)
      .bind(input.relationshipStatus, input.actorUserId, input.now, input.reason, input.now,
        input.relationshipId, input.facilityId, input.fromRelationshipStatus, input.expectedRelationshipVersion, ...caseTransition.values),
    ...auditAndOutboxStatements(d1, {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      facilityId: input.facilityId,
      actionType: `VERIFICATION_${input.toStatus}`,
      entityType: "verification_case",
      entityId: input.verificationCaseId,
      reason: input.reason,
      oldValues: { status: input.fromStatus, relationshipStatus: input.fromRelationshipStatus },
      newValues: { status: input.toStatus, relationshipStatus: input.relationshipStatus },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: `VERIFICATION_${input.toStatus}`,
      payload: { verificationCaseId: input.verificationCaseId, relationshipId: input.relationshipId, status: input.toStatus },
    }, completedTransition),
  ];
}
