import { getD1, getEvidenceBucket } from "../../../../../db/runtime";
import { getRequestContext, getRuntimeValue, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";
import { auditAndOutboxStatements } from "../../../../../lib/server/events";
import { validateEvidenceUpload } from "../../../../../lib/server/evidence-validation";

function safeFilename(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return cleaned || "evidence";
}

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT ed.id, ed.verification_case_id, ed.original_filename, ed.content_type, ed.byte_size, ed.status, ed.retention_until, ed.legal_hold, ed.created_at
      FROM evidence_documents ed WHERE ed.visitor_user_id = ? AND ed.status <> 'DELETED' ORDER BY ed.created_at DESC`).bind(visitor.userId).all();
    return securityResponse({ evidence: result.results }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const bucket = await getEvidenceBucket();
    if (!bucket) throw new SecurityError("EVIDENCE_STORAGE_NOT_CONFIGURED", 503);
    const form = await request.formData();
    const verificationCaseId = String(form.get("verificationCaseId") || "").trim();
    const file = form.get("file");
    if (!verificationCaseId || !(file instanceof File)) throw new SecurityError("EVIDENCE_FILE_REQUIRED", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try { validateEvidenceUpload({ contentType: file.type, bytes }); }
    catch (error) { throw new SecurityError(error instanceof Error ? error.message : "EVIDENCE_FILE_NOT_ALLOWED", 400); }
    const d1 = await getD1();
    const ownedCase = await d1.prepare(`SELECT vc.id, vc.facility_id FROM verification_cases vc INNER JOIN visitor_relationships vr ON vr.id = vc.relationship_id WHERE vc.id = ? AND vr.visitor_user_id = ?`).bind(verificationCaseId, visitor.userId).first<{ id: string; facility_id: string }>();
    if (!ownedCase) throw new SecurityError("VERIFICATION_CASE_NOT_FOUND", 404);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const existingEvidence = await d1.prepare(`SELECT id, retention_until FROM evidence_documents WHERE verification_case_id = ? AND visitor_user_id = ? AND sha256 = ? AND status = 'AVAILABLE' ORDER BY created_at DESC LIMIT 1`)
      .bind(verificationCaseId, visitor.userId, sha256).first<{ id: string; retention_until: string | null }>();
    if (existingEvidence) return securityResponse({ evidenceId: existingEvidence.id, status: "AVAILABLE", retentionUntil: existingEvidence.retention_until, idempotent: true }, 200, context.requestId);
    const id = crypto.randomUUID();
    const storageKey = `${ownedCase.facility_id}/verification/${verificationCaseId}/${id}`;
    const now = new Date();
    const retentionDays = Math.max(1, Number(await getRuntimeValue("EVIDENCE_RETENTION_DAYS") || "365") || 365);
    const retentionUntil = new Date(now.getTime() + retentionDays * 86400000).toISOString();
    await bucket.put(storageKey, bytes, { httpMetadata: { contentType: file.type } });
    const correlationId = crypto.randomUUID();
    try {
      const inserted = await d1.batch([
        d1.prepare(`INSERT INTO evidence_documents (id, facility_id, verification_case_id, visitor_user_id, storage_key, original_filename, content_type, byte_size, sha256, status, retention_until, legal_hold, created_by, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, 0, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM evidence_documents
            WHERE verification_case_id = ? AND visitor_user_id = ? AND sha256 = ? AND status = 'AVAILABLE'
          )`)
          .bind(id, ownedCase.facility_id, verificationCaseId, visitor.userId, storageKey, safeFilename(file.name), file.type, bytes.length, sha256, retentionUntil, visitor.userId, now.toISOString(), now.toISOString(), verificationCaseId, visitor.userId, sha256),
        ...auditAndOutboxStatements(d1, {
          actorUserId: visitor.userId,
          actorRole: "VISITOR",
          facilityId: ownedCase.facility_id,
          actionType: "EVIDENCE_UPLOADED",
          entityType: "evidence_document",
          entityId: id,
          reason: "Visitor uploaded supporting evidence for relationship verification.",
          newValues: { verificationCaseId, contentType: file.type, byteSize: file.size, sha256, status: "AVAILABLE" },
          requestId: context.requestId,
          correlationId,
          eventType: "EVIDENCE_UPLOADED",
          payload: { evidenceId: id, verificationCaseId, visitorUserId: visitor.userId },
        }, { sql: "changes() > 0", values: [] }),
      ]);
      if (!inserted[0]?.meta.changes) {
        await bucket.delete(storageKey);
        const duplicate = await d1.prepare(`SELECT id, retention_until FROM evidence_documents
          WHERE verification_case_id = ? AND visitor_user_id = ? AND sha256 = ? AND status = 'AVAILABLE'
          ORDER BY created_at DESC LIMIT 1`).bind(verificationCaseId, visitor.userId, sha256).first<{ id: string; retention_until: string | null }>();
        if (duplicate) return securityResponse({ evidenceId: duplicate.id, status: "AVAILABLE", retentionUntil: duplicate.retention_until, idempotent: true }, 200, context.requestId);
        throw new SecurityError("EVIDENCE_UPLOAD_NOT_PERSISTED", 409);
      }
    } catch (error) {
      await bucket.delete(storageKey);
      throw error;
    }
    return securityResponse({ evidenceId: id, status: "AVAILABLE", retentionUntil, correlationId }, 201, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
