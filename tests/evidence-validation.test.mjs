import assert from "node:assert/strict";
import test from "node:test";
import { evidenceBytesMatchContentType, validateEvidenceUpload } from "../lib/server/evidence-validation.ts";

test("evidence validation accepts matching PDF, PNG, and JPEG signatures", () => {
  assert.equal(evidenceBytesMatchContentType("application/pdf", new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(evidenceBytesMatchContentType("image/png", Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), true);
  assert.equal(evidenceBytesMatchContentType("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), true);
});

test("evidence validation rejects spoofed MIME types and unsupported content", () => {
  assert.throws(() => validateEvidenceUpload({ contentType: "application/pdf", bytes: new TextEncoder().encode("not a pdf") }), /EVIDENCE_CONTENT_MISMATCH/);
  assert.throws(() => validateEvidenceUpload({ contentType: "image/png", bytes: new TextEncoder().encode("not a png") }), /EVIDENCE_CONTENT_MISMATCH/);
  assert.throws(() => validateEvidenceUpload({ contentType: "text/html", bytes: new TextEncoder().encode("<script>alert(1)</script>") }), /EVIDENCE_FILE_NOT_ALLOWED/);
});
