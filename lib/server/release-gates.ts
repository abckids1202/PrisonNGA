export type ReleaseGateResult = {
  ready: boolean;
  required: string[];
  missing: string[];
  evidence?: { id: string | null; expiresAt: string | null; valid: boolean };
};

const productionGates: Array<[string, string]> = [
  ["SECUREVISIT_RELEASE_APPROVAL", "approved"],
  ["SECUREVISIT_SECURITY_REVIEW", "approved"],
  ["SECUREVISIT_PRIVACY_REVIEW", "approved"],
  ["SECUREVISIT_TARIFF_APPROVAL", "approved"],
  ["SECUREVISIT_REFUND_POLICY_APPROVAL", "approved"],
  ["SECUREVISIT_BACKUP_RESTORE_DRILL", "verified"],
  ["SECUREVISIT_WAF", "enabled"],
  ["SECUREVISIT_MONITORING", "configured"],
  ["SECUREVISIT_OUTAGE_RUNBOOK", "approved"],
  ["SECUREVISIT_IDENTITY_STAGING", "verified"],
  ["SECUREVISIT_PAYMENT_STAGING", "verified"],
  ["SECUREVISIT_NOTIFICATION_STAGING", "verified"],
  ["SECUREVISIT_EVIDENCE_STAGING", "verified"],
  ["SECUREVISIT_KIOSK_STAGING", "verified"],
  ["SECUREVISIT_LIVEKIT_STAGING", "verified"],
];

export function evaluateReleaseGates(environment: string, env: Record<string, unknown>): ReleaseGateResult {
  const required = environment === "production"
    ? [...productionGates.map(([key]) => key), "SECUREVISIT_RELEASE_EVIDENCE_ID", "SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT"]
    : [];
  const missing = productionGates
    .filter(([key, expected]) => required.includes(key) && String(env[key] || "").trim().toLowerCase() !== expected)
    .map(([key, expected]) => `${key}=${expected}`);
  const evidenceId = typeof env.SECUREVISIT_RELEASE_EVIDENCE_ID === "string" ? env.SECUREVISIT_RELEASE_EVIDENCE_ID.trim() : "";
  const evidenceExpiresAt = typeof env.SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT === "string" ? env.SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT.trim() : "";
  const evidenceIdValid = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/.test(evidenceId);
  const evidenceExpiryMs = Date.parse(evidenceExpiresAt);
  const evidenceExpiryValid = Number.isFinite(evidenceExpiryMs) && evidenceExpiryMs > Date.now();
  if (environment === "production" && !evidenceIdValid) missing.push("SECUREVISIT_RELEASE_EVIDENCE_ID=present");
  if (environment === "production" && !evidenceExpiryValid) missing.push("SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT=future");
  return {
    ready: missing.length === 0,
    required,
    missing,
    evidence: { id: evidenceId || null, expiresAt: evidenceExpiresAt || null, valid: environment !== "production" || evidenceIdValid && evidenceExpiryValid },
  };
}
