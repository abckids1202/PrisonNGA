import { getD1 } from "../../../../db/runtime";
import { verificationDecisionStatements } from "../../../../lib/server/verification-decisions";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const reviewStatuses = ["APPROVED", "REJECTED", "MORE_INFO"] as const;
type ReviewStatus = typeof reviewStatuses[number];

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("verification.review");
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT vc.id, vc.relationship_id, vc.status, vc.evidence_required, vc.submitted_at, vc.reviewed_at, vc.review_reason, vc.version, vr.visitor_user_id, vr.prisoner_id, vr.relationship_type, u.display_name AS visitor_name, p.prisoner_number, p.display_name AS prisoner_name,
        (SELECT COUNT(*) FROM evidence_documents ed WHERE ed.verification_case_id = vc.id AND ed.facility_id = vc.facility_id AND ed.status = 'AVAILABLE') AS evidence_count
      FROM verification_cases vc INNER JOIN visitor_relationships vr ON vr.id = vc.relationship_id INNER JOIN users u ON u.id = vr.visitor_user_id INNER JOIN prisoners p ON p.id = vr.prisoner_id
      WHERE vc.facility_id = ? ORDER BY vc.submitted_at ASC`).bind(authorization.facilityId).all();
    return securityResponse({ cases: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("verification.review");
    const body = await request.json() as { verificationCaseId?: unknown; status?: unknown; reason?: unknown; expectedVersion?: unknown };
    const verificationCaseId = typeof body.verificationCaseId === "string" ? body.verificationCaseId.trim() : "";
    const status = body.status as ReviewStatus;
    if (!verificationCaseId || !reviewStatuses.includes(status)) throw new SecurityError("INVALID_VERIFICATION_REVIEW", 400);
    const reason = assertReason(body.reason);
    d1 = await getD1();
    const current = await d1.prepare(`SELECT vc.id, vc.relationship_id, vc.status, vc.evidence_required, vc.version, vr.status AS relationship_status, vr.version AS relationship_version FROM verification_cases vc INNER JOIN visitor_relationships vr ON vr.id = vc.relationship_id WHERE vc.id = ? AND vc.facility_id = ?`).bind(verificationCaseId, authorization.facilityId).first<{ id: string; relationship_id: string; status: string; evidence_required: number; version: number; relationship_status: string; relationship_version: number }>();
    if (!current) throw new SecurityError("VERIFICATION_CASE_NOT_FOUND", 404);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const idempotencyScope = `verification-review:${authorization.facilityId}:${authorization.userId}:${verificationCaseId}`;
    const requestHash = await hashIdempotencyPayload({ verificationCaseId, status, reason, expectedVersion: body.expectedVersion ?? current.version });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope: idempotencyScope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope: idempotencyScope, key: idempotencyKey };
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) throw new SecurityError("STALE_VERIFICATION_CASE", 409);
    if (["APPROVED", "REJECTED"].includes(current.status)) {
      const responseBody = { verificationCaseId, status: current.status, relationshipStatus: current.relationship_status, version: current.version, idempotent: true };
      const completed = await d1.prepare("UPDATE idempotency_records SET status = 'COMPLETED', response_status = ?, response_body = ?, completed_at = ? WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'").bind(200, JSON.stringify(responseBody), new Date().toISOString(), idempotency.claimId, idempotency.scope, idempotency.key).run();
      if (!completed.meta.changes) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
      idempotency = null;
      return securityResponse(responseBody, 200, context.requestId);
    }
    const relationshipStatus = status === "APPROVED" ? "APPROVED" : status === "REJECTED" ? "REJECTED" : "PENDING";
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { verificationCaseId, status, relationshipStatus, version: current.version + 1, correlationId };
    const completedGuard = { sql: "EXISTS (SELECT 1 FROM verification_cases WHERE id = ? AND facility_id = ? AND status = ? AND version = ?) AND EXISTS (SELECT 1 FROM visitor_relationships WHERE id = ? AND facility_id = ? AND status = ? AND version = ?)", values: [verificationCaseId, authorization.facilityId, status, current.version + 1, current.relationship_id, authorization.facilityId, relationshipStatus, current.relationship_version + 1] };
    const results = await d1.batch([...verificationDecisionStatements(d1, {
      verificationCaseId,
      relationshipId: current.relationship_id,
      facilityId: authorization.facilityId,
      fromStatus: current.status,
      toStatus: status,
      expectedCaseVersion: current.version,
      fromRelationshipStatus: current.relationship_status,
      expectedRelationshipVersion: current.relationship_version,
      relationshipStatus,
      evidenceRequired: Boolean(current.evidence_required),
      actorUserId: authorization.userId,
      actorRole: authorization.roles[0] || "Verification Officer",
      reason,
      requestId: context.requestId,
      correlationId,
      now,
    }), completeIdempotencyStatement(d1, { ...idempotency, status: 200, body: responseBody, guard: completedGuard })]);
    if (!results[0]?.meta.changes) {
      if (status === "APPROVED" && current.evidence_required) {
        const evidence = await d1.prepare("SELECT 1 AS present FROM evidence_documents WHERE verification_case_id = ? AND facility_id = ? AND status = 'AVAILABLE' LIMIT 1").bind(verificationCaseId, authorization.facilityId).first();
        if (!evidence) throw new SecurityError("VERIFICATION_EVIDENCE_REQUIRED", 409);
      }
      throw new SecurityError("STALE_VERIFICATION_CASE", 409);
    }
    if (!results[results.length - 1]?.meta.changes) throw new SecurityError("VERIFICATION_REVIEW_NOT_PERSISTED", 409);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original verification review error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
