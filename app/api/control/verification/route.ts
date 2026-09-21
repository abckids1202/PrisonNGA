import { getD1 } from "../../../../db/runtime";
import { appendAuditAndOutbox } from "../../../../lib/server/events";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const reviewStatuses = ["APPROVED", "REJECTED", "MORE_INFO"] as const;
type ReviewStatus = typeof reviewStatuses[number];

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("verification.review");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT vc.id, vc.relationship_id, vc.status, vc.evidence_required, vc.submitted_at, vc.reviewed_at, vc.review_reason, vc.version, vr.visitor_user_id, vr.prisoner_id, vr.relationship_type, u.display_name AS visitor_name, p.prisoner_number, p.display_name AS prisoner_name
      FROM verification_cases vc INNER JOIN visitor_relationships vr ON vr.id = vc.relationship_id INNER JOIN users u ON u.id = vr.visitor_user_id INNER JOIN prisoners p ON p.id = vr.prisoner_id
      WHERE vc.facility_id = ? ORDER BY vc.submitted_at ASC`).bind(authorization.facilityId).all();
    return securityResponse({ cases: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("verification.review");
    const body = await request.json() as { verificationCaseId?: unknown; status?: unknown; reason?: unknown; expectedVersion?: unknown };
    const verificationCaseId = typeof body.verificationCaseId === "string" ? body.verificationCaseId.trim() : "";
    const status = body.status as ReviewStatus;
    if (!verificationCaseId || !reviewStatuses.includes(status)) throw new SecurityError("INVALID_VERIFICATION_REVIEW", 400);
    const reason = assertReason(body.reason);
    const d1 = await getD1();
    const current = await d1.prepare(`SELECT vc.id, vc.relationship_id, vc.status, vc.version, vr.status AS relationship_status FROM verification_cases vc INNER JOIN visitor_relationships vr ON vr.id = vc.relationship_id WHERE vc.id = ? AND vc.facility_id = ?`).bind(verificationCaseId, authorization.facilityId).first<{ id: string; relationship_id: string; status: string; version: number; relationship_status: string }>();
    if (!current) throw new SecurityError("VERIFICATION_CASE_NOT_FOUND", 404);
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) throw new SecurityError("STALE_VERIFICATION_CASE", 409);
    if (["APPROVED", "REJECTED"].includes(current.status)) return securityResponse({ verificationCaseId, status: current.status, idempotent: true }, 200, context.requestId);
    const relationshipStatus = status === "APPROVED" ? "APPROVED" : status === "REJECTED" ? "REJECTED" : "PENDING";
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const results = await d1.batch([
      d1.prepare(`UPDATE verification_cases SET status = ?, reviewed_by = ?, reviewed_at = ?, review_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?`).bind(status, authorization.userId, now, reason, now, verificationCaseId, authorization.facilityId, current.version),
      d1.prepare(`UPDATE visitor_relationships SET status = ?, reviewed_by = ?, reviewed_at = ?, review_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ?`).bind(relationshipStatus, authorization.userId, now, reason, now, current.relationship_id, authorization.facilityId),
    ]);
    if (!results[0]?.meta.changes) throw new SecurityError("STALE_VERIFICATION_CASE", 409);
    await appendAuditAndOutbox({ actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Verification Officer", facilityId: authorization.facilityId, actionType: `VERIFICATION_${status}`, entityType: "verification_case", entityId: verificationCaseId, reason, oldValues: { status: current.status }, newValues: { status, relationshipStatus }, requestId: context.requestId, correlationId, eventType: `VERIFICATION_${status}`, payload: { verificationCaseId, relationshipId: current.relationship_id, status } });
    return securityResponse({ verificationCaseId, status, relationshipStatus, version: current.version + 1, correlationId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
