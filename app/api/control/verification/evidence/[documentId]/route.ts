import { getD1, getEvidenceBucket } from "../../../../../../db/runtime";
import { applySecurityHeaders, getRequestContext, requireActiveBreakGlass, requirePermission, securityErrorResponse, SecurityError } from "../../../../../../lib/server/security";

type RouteContext = { params: Promise<{ documentId: string }> };
const allowedTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);

export async function GET(_request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const { documentId } = await context.params;
    if (!documentId || documentId.length > 128) throw new SecurityError("EVIDENCE_NOT_FOUND", 404);
    let authorization: Awaited<ReturnType<typeof requirePermission>>;
    let breakGlassRequestId: string | null = null;
    try {
      authorization = await requirePermission("verification.review");
    } catch (error) {
      if (!(error instanceof SecurityError) || error.statusCode !== 403) throw error;
      authorization = await requirePermission("access.break_glass.request");
      breakGlassRequestId = "pending";
    }
    const d1 = await getD1();
    const evidence = await d1.prepare(`SELECT ed.id, ed.verification_case_id, ed.storage_key, ed.original_filename, ed.content_type, ed.byte_size, ed.sha256
      FROM evidence_documents ed INNER JOIN verification_cases vc ON vc.id = ed.verification_case_id AND vc.facility_id = ed.facility_id
      WHERE ed.id = ? AND ed.facility_id = ? AND vc.facility_id = ? AND ed.status = 'AVAILABLE'`)
      .bind(documentId, authorization.facilityId, authorization.facilityId)
      .first<{ id: string; verification_case_id: string; storage_key: string; original_filename: string; content_type: string; byte_size: number; sha256: string }>();
    if (!evidence) throw new SecurityError("EVIDENCE_NOT_FOUND", 404);
    if (breakGlassRequestId) {
      const grant = await requireActiveBreakGlass(d1, { facilityId: authorization.facilityId, userId: authorization.userId, targetType: "evidence_document", targetId: evidence.id });
      breakGlassRequestId = grant.requestId;
    }
    if (!allowedTypes.has(evidence.content_type) || evidence.byte_size < 1 || evidence.byte_size > 10 * 1024 * 1024) throw new SecurityError("EVIDENCE_NOT_AVAILABLE", 409);
    const bucket = await getEvidenceBucket();
    if (!bucket) throw new SecurityError("EVIDENCE_STORAGE_NOT_CONFIGURED", 503);
    const object = await bucket.get(evidence.storage_key);
    if (!object?.body || object.size !== evidence.byte_size) throw new SecurityError("EVIDENCE_NOT_AVAILABLE", 404);
    const bytes = new Uint8Array(await object.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (sha256 !== evidence.sha256) throw new SecurityError("EVIDENCE_INTEGRITY_CHECK_FAILED", 409);

    const correlationId = crypto.randomUUID();
    await d1.prepare(`INSERT INTO audit_events
      (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'evidence_document', ?, ?, NULL, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        authorization.userId,
        breakGlassRequestId ? "Break-glass reviewer" : authorization.roles[0] || "Verification Officer",
        authorization.facilityId,
        breakGlassRequestId ? "BREAK_GLASS_EVIDENCE_ACCESSED" : "VERIFICATION_EVIDENCE_ACCESSED",
        evidence.id,
        breakGlassRequestId ? `Evidence accessed under approved break-glass request ${breakGlassRequestId}.` : "Authorized verification reviewer accessed submitted evidence.",
        breakGlassRequestId ? JSON.stringify({ breakGlassRequestId }) : null,
        correlationId,
        requestContext.requestId,
        new Date().toISOString(),
      )
      .run();

    const filename = evidence.original_filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "evidence";
    const headers = new Headers({
      "Content-Type": evidence.content_type,
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store, max-age=0",
    });
    const response = new Response(bytes, { status: 200, headers });
    applySecurityHeaders(response, requestContext.requestId);
    response.headers.set("Content-Type", evidence.content_type);
    response.headers.set("Content-Length", String(object.size));
    response.headers.set("Content-Disposition", `inline; filename="${filename}"`);
    response.headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return response;
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}
