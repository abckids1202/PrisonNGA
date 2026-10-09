import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReleaseGates } from "../lib/server/release-gates.ts";

test("production readiness requires approved tariff and refund policy attestations", () => {
  const baseline = {
    SECUREVISIT_RELEASE_APPROVAL: "approved",
    SECUREVISIT_SECURITY_REVIEW: "approved",
    SECUREVISIT_PRIVACY_REVIEW: "approved",
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
    SECUREVISIT_RELEASE_EVIDENCE_ID: "release-2026-10-09-001",
    SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT: "2099-01-01T00:00:00.000Z",
  };

  const missingBoth = evaluateReleaseGates("production", baseline);
  assert.equal(missingBoth.ready, false);
  assert.deepEqual(missingBoth.missing.slice(0, 2), [
    "SECUREVISIT_TARIFF_APPROVAL=approved",
    "SECUREVISIT_REFUND_POLICY_APPROVAL=approved",
  ]);

  const approved = evaluateReleaseGates("production", {
    ...baseline,
    SECUREVISIT_TARIFF_APPROVAL: "approved",
    SECUREVISIT_REFUND_POLICY_APPROVAL: "approved",
  });
  assert.equal(approved.ready, true);
  assert.deepEqual(approved.missing, []);
});

test("production readiness rejects missing or expired release evidence", () => {
  const approved = {
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
  const result = evaluateReleaseGates("production", { ...approved, SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT: "2020-01-01T00:00:00.000Z" });
  assert.equal(result.ready, false);
  assert.equal(result.evidence?.valid, false);
  assert.ok(result.missing.includes("SECUREVISIT_RELEASE_EVIDENCE_ID=present"));
  assert.ok(result.missing.includes("SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT=future"));
});
