export type ReleaseGateResult = {
  ready: boolean;
  required: string[];
  missing: string[];
  evidence?: { id: string | null; expiresAt: string | null; valid: boolean; manifestValid: boolean };
};

type ReleaseEvidenceManifest = {
  releaseId?: unknown;
  expiresAt?: unknown;
  gates?: unknown;
};

export const pilotEvidenceGates: Array<[string, string]> = [
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

const productionGates: Array<[string, string]> = [
  ["SECUREVISIT_RELEASE_APPROVAL", "approved"],
  ["SECUREVISIT_SECURITY_REVIEW", "approved"],
  ["SECUREVISIT_PRIVACY_REVIEW", "approved"],
  ...pilotEvidenceGates,
];

export function evaluateReleaseGates(environment: string, env: Record<string, unknown>): ReleaseGateResult {
  const required = environment === "production"
    ? [...productionGates.map(([key]) => key), "SECUREVISIT_RELEASE_EVIDENCE_ID", "SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT", "SECUREVISIT_RELEASE_EVIDENCE_MANIFEST"]
    : [];
  const missing = productionGates
    .filter(([key, expected]) => required.includes(key) && String(env[key] || "").trim().toLowerCase() !== expected)
    .map(([key, expected]) => `${key}=${expected}`);
  const evidenceId = typeof env.SECUREVISIT_RELEASE_EVIDENCE_ID === "string" ? env.SECUREVISIT_RELEASE_EVIDENCE_ID.trim() : "";
  const evidenceExpiresAt = typeof env.SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT === "string" ? env.SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT.trim() : "";
  const evidenceIdValid = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/.test(evidenceId);
  const evidenceExpiryMs = Date.parse(evidenceExpiresAt);
  const evidenceExpiryValid = Number.isFinite(evidenceExpiryMs) && evidenceExpiryMs > Date.now();
  let manifest: ReleaseEvidenceManifest | null = null;
  const manifestRaw = typeof env.SECUREVISIT_RELEASE_EVIDENCE_MANIFEST === "string" ? env.SECUREVISIT_RELEASE_EVIDENCE_MANIFEST.trim() : "";
  if (manifestRaw) {
    try {
      const parsed = JSON.parse(manifestRaw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) manifest = parsed as ReleaseEvidenceManifest;
    } catch {
      manifest = null;
    }
  }
  const manifestReleaseId = typeof manifest?.releaseId === "string" ? manifest.releaseId.trim() : "";
  const manifestExpiresAt = typeof manifest?.expiresAt === "string" ? manifest.expiresAt.trim() : "";
  const manifestExpiryMs = Date.parse(manifestExpiresAt);
  const manifestBaseValid = Boolean(manifest) && manifestReleaseId === evidenceId && manifestExpiresAt === evidenceExpiresAt
    && evidenceIdValid && Number.isFinite(manifestExpiryMs) && manifestExpiryMs > Date.now();
  let manifestValid = environment !== "production" || manifestBaseValid;
  if (environment === "production" && !manifestBaseValid) missing.push("SECUREVISIT_RELEASE_EVIDENCE_MANIFEST=matching-valid-json");
  const manifestGates = manifest?.gates && typeof manifest.gates === "object" && !Array.isArray(manifest.gates) ? manifest.gates as Record<string, unknown> : null;
  for (const [key, expected] of productionGates) {
    if (environment !== "production") continue;
    const record = manifestGates?.[key];
    const entry = record && typeof record === "object" && !Array.isArray(record) ? record as Record<string, unknown> : null;
    const status = typeof entry?.status === "string" ? entry.status.trim().toLowerCase() : "";
    const entryId = typeof entry?.evidenceId === "string" ? entry.evidenceId.trim() : "";
    const entryExpiry = typeof entry?.expiresAt === "string" ? entry.expiresAt.trim() : "";
    const entryExpiryMs = Date.parse(entryExpiry);
    const entryValid = status === expected && /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/.test(entryId) && Number.isFinite(entryExpiryMs) && entryExpiryMs > Date.now();
    if (!entryValid) {
      manifestValid = false;
      missing.push(`SECUREVISIT_RELEASE_EVIDENCE_MANIFEST.gates.${key}=valid`);
    }
  }
  if (environment === "production" && !evidenceIdValid) missing.push("SECUREVISIT_RELEASE_EVIDENCE_ID=present");
  if (environment === "production" && !evidenceExpiryValid) missing.push("SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT=future");
  return {
    ready: missing.length === 0,
    required,
    missing,
    evidence: { id: evidenceId || null, expiresAt: evidenceExpiresAt || null, valid: environment !== "production" || evidenceIdValid && evidenceExpiryValid && manifestValid, manifestValid },
  };
}
