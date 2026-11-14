import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateReleaseEvidence } from "../scripts/validate-release-evidence.mjs";

const gates = {
  SECUREVISIT_RELEASE_APPROVAL: "approved",
  SECUREVISIT_SECURITY_REVIEW: "approved",
  SECUREVISIT_PRIVACY_REVIEW: "approved",
  SECUREVISIT_TARIFF_APPROVAL: "approved",
  SECUREVISIT_REFUND_POLICY_APPROVAL: "approved",
  SECUREVISIT_BACKUP_RESTORE_DRILL: "verified",
  SECUREVISIT_WAF: "enabled",
  SECUREVISIT_MONITORING: "configured",
  SECUREVISIT_OUTAGE_RUNBOOK: "approved",
  SECUREVISIT_IDENTITY_STAGING: "verified",
  SECUREVISIT_PAYMENT_STAGING: "verified",
  SECUREVISIT_NOTIFICATION_STAGING: "verified",
  SECUREVISIT_EVIDENCE_STAGING: "verified",
  SECUREVISIT_KIOSK_STAGING: "verified",
  SECUREVISIT_LIVEKIT_STAGING: "verified",
};

test("release evidence command validates matching future-dated manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "securevisit-evidence-"));
  const manifestPath = join(directory, "manifest.json");
  const releaseId = "release-test-001";
  const expiresAt = "2099-01-01T00:00:00.000Z";
  await writeFile(manifestPath, JSON.stringify({ releaseId, expiresAt, gates: Object.fromEntries(Object.entries(gates).map(([key, status]) => [key, { status, evidenceId: `evidence-${key.toLowerCase()}`, expiresAt }])) }));
  try {
    const result = await validateReleaseEvidence({ environment: "production", manifestPath, env: { ...gates, SECUREVISIT_RELEASE_EVIDENCE_ID: releaseId, SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT: expiresAt } });
    assert.equal(result.ready, true, JSON.stringify(result));
    assert.equal(result.evidence?.manifestValid, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release evidence command rejects a missing gate", async () => {
  const result = await validateReleaseEvidence({ environment: "staging", env: { SECUREVISIT_TARIFF_APPROVAL: "approved" } });
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes("SECUREVISIT_REFUND_POLICY_APPROVAL=approved"));
});

test("staging evidence requires a matching future-dated pilot manifest", async () => {
  const releaseId = "staging-release-001";
  const expiresAt = "2099-01-01T00:00:00.000Z";
  const manifest = { releaseId, expiresAt, gates: Object.fromEntries(Object.entries(gates).filter(([key]) => key.endsWith("_STAGING") || key === "SECUREVISIT_TARIFF_APPROVAL" || key === "SECUREVISIT_REFUND_POLICY_APPROVAL" || key === "SECUREVISIT_WAF" || key === "SECUREVISIT_MONITORING" || key === "SECUREVISIT_BACKUP_RESTORE_DRILL" || key === "SECUREVISIT_OUTAGE_RUNBOOK").map(([key, status]) => [key, { status, evidenceId: `evidence-${key.toLowerCase()}`, expiresAt }])) };
  const result = await validateReleaseEvidence({ environment: "staging", env: { ...gates, SECUREVISIT_STAGING_EVIDENCE_ID: releaseId, SECUREVISIT_STAGING_EVIDENCE_EXPIRES_AT: expiresAt, SECUREVISIT_STAGING_EVIDENCE_MANIFEST: JSON.stringify(manifest) } });
  assert.equal(result.ready, true, JSON.stringify(result));
  assert.equal(result.evidence?.manifestValid, true);
});
