export const ALLOWED_EVIDENCE_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export function evidenceBytesMatchContentType(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (contentType === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

export function validateEvidenceUpload(input: { contentType: string; bytes: Uint8Array }): void {
  if (!ALLOWED_EVIDENCE_TYPES.has(input.contentType) || input.bytes.length < 1 || input.bytes.length > MAX_EVIDENCE_BYTES) throw new Error("EVIDENCE_FILE_NOT_ALLOWED");
  if (!evidenceBytesMatchContentType(input.contentType, input.bytes)) throw new Error("EVIDENCE_CONTENT_MISMATCH");
}
