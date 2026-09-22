import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { appendAuditAndOutbox } from "../../../../lib/server/events";

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT vr.id, vr.facility_id, f.name AS facility_name, vr.prisoner_id, p.prisoner_number, p.display_name AS prisoner_name, vr.relationship_type, vr.status, vr.review_reason, vr.version, vr.created_at, vr.updated_at, vc.id AS verification_case_id, vc.status AS verification_status,
        (SELECT COUNT(*) FROM evidence_documents ed WHERE ed.verification_case_id = vc.id AND ed.facility_id = vc.facility_id AND ed.status = 'AVAILABLE') AS evidence_count
      FROM visitor_relationships vr INNER JOIN prisoners p ON p.id = vr.prisoner_id INNER JOIN facilities f ON f.id = vr.facility_id LEFT JOIN verification_cases vc ON vc.relationship_id = vr.id
      WHERE vr.visitor_user_id = ? ORDER BY vr.created_at DESC`).bind(visitor.userId).all();
    return securityResponse({ relationships: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { facilityId?: unknown; prisonerId?: unknown; relationshipType?: unknown };
    const facilityId = typeof body.facilityId === "string" ? body.facilityId.trim() : "";
    const prisonerId = typeof body.prisonerId === "string" ? body.prisonerId.trim() : "";
    const relationshipType = typeof body.relationshipType === "string" ? body.relationshipType.trim().slice(0, 80) : "";
    if (!facilityId || !prisonerId || relationshipType.length < 2) throw new SecurityError("INVALID_RELATIONSHIP_REQUEST", 400);
    const d1 = await getD1();
    const prisoner = await d1.prepare("SELECT id, facility_id, status, visitation_status FROM prisoners WHERE id = ? AND facility_id = ?").bind(prisonerId, facilityId).first<{ id: string; facility_id: string; status: string; visitation_status: string }>();
    if (!prisoner || prisoner.status !== "ACTIVE" || prisoner.visitation_status !== "APPROVED") throw new SecurityError("PRISONER_NOT_AVAILABLE", 404);
    const existing = await d1.prepare(`SELECT vr.id, vr.status, vc.id AS verification_id FROM visitor_relationships vr LEFT JOIN verification_cases vc ON vc.relationship_id = vr.id WHERE vr.visitor_user_id = ? AND vr.prisoner_id = ?`).bind(visitor.userId, prisonerId).first<{ id: string; status: string; verification_id: string | null }>();
    if (existing) return securityResponse({ relationshipId: existing.id, verificationId: existing.verification_id, status: existing.status, idempotent: true }, 200, context.requestId);
    const relationshipId = crypto.randomUUID();
    const verificationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await d1.batch([
      d1.prepare(`INSERT INTO visitor_relationships (id, facility_id, visitor_user_id, prisoner_id, relationship_type, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PENDING', 1, ?, ?)`)
        .bind(relationshipId, facilityId, visitor.userId, prisonerId, relationshipType, now, now),
      d1.prepare(`INSERT INTO verification_cases (id, facility_id, relationship_id, status, evidence_required, submitted_at, version, created_at, updated_at) VALUES (?, ?, ?, 'PENDING', 1, ?, 1, ?, ?)`)
        .bind(verificationId, facilityId, relationshipId, now, now, now),
    ]);
    await appendAuditAndOutbox({ actorUserId: visitor.userId, actorRole: "VISITOR", facilityId, actionType: "RELATIONSHIP_SUBMITTED", entityType: "visitor_relationship", entityId: relationshipId, reason: "Visitor submitted a prisoner relationship for staff verification.", newValues: { prisonerId, relationshipType, status: "PENDING" }, requestId: context.requestId, correlationId, eventType: "RELATIONSHIP_SUBMITTED", payload: { relationshipId, verificationId, visitorUserId: visitor.userId } });
    return securityResponse({ relationshipId, verificationId, status: "PENDING", correlationId }, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
