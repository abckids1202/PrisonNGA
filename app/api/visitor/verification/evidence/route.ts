import { getD1, getEvidenceBucket } from "../../../../../db/runtime";
import { getRequestContext, getRuntimeValue, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

const allowedTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);
const maxBytes = 10 * 1024 * 1024;

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
    if (!allowedTypes.has(file.type) || file.size < 1 || file.size > maxBytes) throw new SecurityError("EVIDENCE_FILE_NOT_ALLOWED", 400);
    const d1 = await getD1();
    const ownedCase = await d1.prepare(`SELECT vc.id, vc.facility_id FROM verification_cases vc INNER JOIN visitor_relationships vr ON vr.id = vc.relationship_id WHERE vc.id = ? AND vr.visitor_user_id = ?`).bind(verificationCaseId, visitor.userId).first<{ id: string; facility_id: string }>();
    if (!ownedCase) throw new SecurityError("VERIFICATION_CASE_NOT_FOUND", 404);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const id = crypto.randomUUID();
    const storageKey = `${ownedCase.facility_id}/verification/${verificationCaseId}/${id}`;
    const now = new Date();
    const retentionDays = Math.max(1, Number(await getRuntimeValue("EVIDENCE_RETENTION_DAYS") || "365") || 365);
    const retentionUntil = new Date(now.getTime() + retentionDays * 86400000).toISOString();
    await bucket.put(storageKey, bytes, { httpMetadata: { contentType: file.type } });
    try {
      await d1.prepare(`INSERT INTO evidence_documents (id, facility_id, verification_case_id, visitor_user_id, storage_key, original_filename, content_type, byte_size, sha256, status, retention_until, legal_hold, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, 0, ?, ?, ?)`).bind(id, ownedCase.facility_id, verificationCaseId, visitor.userId, storageKey, safeFilename(file.name), file.type, file.size, sha256, retentionUntil, visitor.userId, now.toISOString(), now.toISOString()).run();
    } catch (error) {
      await bucket.delete(storageKey);
      throw error;
    }
    return securityResponse({ evidenceId: id, status: "AVAILABLE", retentionUntil }, 201, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
