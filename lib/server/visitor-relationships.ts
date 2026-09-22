import { auditAndOutboxStatements } from "./events";

export type CreateVisitorRelationshipInput = {
  relationshipId: string;
  verificationId: string;
  facilityId: string;
  visitorUserId: string;
  prisonerId: string;
  relationshipType: string;
  now: string;
  requestId: string;
  correlationId: string;
};

export function createVisitorRelationshipStatements(
  d1: D1Database,
  input: CreateVisitorRelationshipInput,
): D1PreparedStatement[] {
  const caseCreated = {
    sql: `EXISTS (SELECT 1 FROM verification_cases vc
      INNER JOIN visitor_relationships vr ON vr.id = vc.relationship_id AND vr.facility_id = vc.facility_id
      WHERE vc.id = ? AND vc.facility_id = ? AND vc.relationship_id = ? AND vc.status = 'PENDING'
        AND vr.visitor_user_id = ? AND vr.prisoner_id = ? AND vr.status = 'PENDING')`,
    values: [input.verificationId, input.facilityId, input.relationshipId, input.visitorUserId, input.prisonerId],
  };

  return [
    d1.prepare(`INSERT INTO visitor_relationships
      (id, facility_id, visitor_user_id, prisoner_id, relationship_type, status, version, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, 'PENDING', 1, ?, ?
      FROM prisoners p
      WHERE p.id = ? AND p.facility_id = ? AND p.status = 'ACTIVE' AND p.visitation_status = 'APPROVED'
      ON CONFLICT(visitor_user_id, prisoner_id) DO NOTHING`)
      .bind(input.relationshipId, input.facilityId, input.visitorUserId, input.prisonerId, input.relationshipType,
        input.now, input.now, input.prisonerId, input.facilityId),
    d1.prepare(`INSERT INTO verification_cases
      (id, facility_id, relationship_id, status, evidence_required, submitted_at, version, created_at, updated_at)
      SELECT ?, ?, ?, 'PENDING', 1, ?, 1, ?, ?
      WHERE EXISTS (SELECT 1 FROM visitor_relationships WHERE id = ? AND facility_id = ?
        AND visitor_user_id = ? AND prisoner_id = ? AND status = 'PENDING')`)
      .bind(input.verificationId, input.facilityId, input.relationshipId, input.now, input.now, input.now,
        input.relationshipId, input.facilityId, input.visitorUserId, input.prisonerId),
    ...auditAndOutboxStatements(d1, {
      actorUserId: input.visitorUserId,
      actorRole: "VISITOR",
      facilityId: input.facilityId,
      actionType: "RELATIONSHIP_SUBMITTED",
      entityType: "visitor_relationship",
      entityId: input.relationshipId,
      reason: "Visitor submitted a prisoner relationship for staff verification.",
      newValues: { prisonerId: input.prisonerId, relationshipType: input.relationshipType, status: "PENDING" },
      requestId: input.requestId,
      correlationId: input.correlationId,
      eventType: "RELATIONSHIP_SUBMITTED",
      payload: { relationshipId: input.relationshipId, verificationId: input.verificationId, visitorUserId: input.visitorUserId },
    }, caseCreated),
  ];
}
