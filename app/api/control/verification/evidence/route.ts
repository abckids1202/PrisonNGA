import { getD1 } from "../../../../../db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("verification.review");
    const verificationCaseId = new URL(request.url).searchParams.get("verificationCaseId")?.trim() || "";
    if (!verificationCaseId) throw new SecurityError("VERIFICATION_CASE_REQUIRED", 400);
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT ed.id, ed.verification_case_id, ed.original_filename, ed.content_type, ed.byte_size, ed.sha256, ed.status, ed.retention_until, ed.legal_hold, ed.created_at
      FROM evidence_documents ed WHERE ed.facility_id = ? AND ed.verification_case_id = ? AND ed.status <> 'DELETED' ORDER BY ed.created_at DESC`).bind(authorization.facilityId, verificationCaseId).all();
    return securityResponse({ evidence: result.results, downloadable: false }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
