export type ReleaseGateResult = {
  ready: boolean;
  required: string[];
  missing: string[];
};

const productionGates: Array<[string, string]> = [
  ["SECUREVISIT_RELEASE_APPROVAL", "approved"],
  ["SECUREVISIT_SECURITY_REVIEW", "approved"],
  ["SECUREVISIT_PRIVACY_REVIEW", "approved"],
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
  const required = environment === "production" ? productionGates.map(([key]) => key) : [];
  const missing = productionGates
    .filter(([key, expected]) => required.includes(key) && String(env[key] || "").trim().toLowerCase() !== expected)
    .map(([key, expected]) => `${key}=${expected}`);
  return { ready: missing.length === 0, required, missing };
}
