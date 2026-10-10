import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

function runAudit(extra = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/audit-pilot.mjs", ...extra], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("pilot audit emits a redacted actionable report without failing normal development use", async () => {
  const result = await runAudit([], { SECUREVISIT_ENVIRONMENT: "development", PILOT_AUDIT_SECRET: "must-not-appear" });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.environment, "development");
  assert.equal(report.readyForPilot, false);
  assert.ok(Array.isArray(report.nextActions));
  assert.ok(report.nextActions.some((action) => action.includes("PUBLIC_APP_URL")));
  assert.ok(report.nextActions.some((action) => action.includes("D1_DATABASE_ID")));
  assert.equal(report.checks.find((check) => check.id === "release-artifacts")?.ok, true);
  assert.doesNotMatch(result.stdout, /must-not-appear/);
});

test("strict pilot audit fails closed outside development until configuration and evidence exist", async () => {
  const result = await runAudit(["--strict"], { SECUREVISIT_ENVIRONMENT: "staging" });
  assert.notEqual(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readyForPilot, false);
  assert.ok(report.missingConfiguration.length > 0);
  assert.ok(report.missingStagingEvidence.includes("SECUREVISIT_LIVEKIT_STAGING=verified"));
});

test("environment template declares every pilot evidence gate", async () => {
  const template = await readFile(".env.example", "utf8");
  for (const key of [
    "SECUREVISIT_RELEASE_APPROVAL",
    "SECUREVISIT_SECURITY_REVIEW",
    "SECUREVISIT_PRIVACY_REVIEW",
    "SECUREVISIT_TARIFF_APPROVAL",
    "SECUREVISIT_REFUND_POLICY_APPROVAL",
    "SECUREVISIT_BACKUP_RESTORE_DRILL",
    "SECUREVISIT_WAF",
    "SECUREVISIT_MONITORING",
    "SECUREVISIT_OUTAGE_RUNBOOK",
    "SECUREVISIT_IDENTITY_STAGING",
    "SECUREVISIT_PAYMENT_STAGING",
    "SECUREVISIT_NOTIFICATION_STAGING",
    "SECUREVISIT_EVIDENCE_STAGING",
    "SECUREVISIT_KIOSK_STAGING",
    "SECUREVISIT_LIVEKIT_STAGING",
  ]) assert.match(template, new RegExp(`^${key}=`, "m"));
});

test("pilot evidence register maps every release gate", async () => {
  const register = await readFile("docs/PILOT_EVIDENCE_REGISTER.md", "utf8");
  for (const key of [
    "SECUREVISIT_RELEASE_APPROVAL",
    "SECUREVISIT_SECURITY_REVIEW",
    "SECUREVISIT_PRIVACY_REVIEW",
    "SECUREVISIT_TARIFF_APPROVAL",
    "SECUREVISIT_REFUND_POLICY_APPROVAL",
    "SECUREVISIT_BACKUP_RESTORE_DRILL",
    "SECUREVISIT_WAF",
    "SECUREVISIT_MONITORING",
    "SECUREVISIT_OUTAGE_RUNBOOK",
    "SECUREVISIT_IDENTITY_STAGING",
    "SECUREVISIT_PAYMENT_STAGING",
    "SECUREVISIT_NOTIFICATION_STAGING",
    "SECUREVISIT_EVIDENCE_STAGING",
    "SECUREVISIT_KIOSK_STAGING",
    "SECUREVISIT_LIVEKIT_STAGING",
  ]) assert.ok(register.includes(`| \`${key}\` |`), `missing register entry for ${key}`);
});
