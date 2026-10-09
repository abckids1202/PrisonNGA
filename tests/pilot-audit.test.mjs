import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  assert.doesNotMatch(result.stdout, /must-not-appear/);
});

test("strict pilot audit fails closed outside development until configuration and evidence exist", async () => {
  const result = await runAudit(["--strict"], { SECUREVISIT_ENVIRONMENT: "staging" });
  assert.notEqual(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readyForPilot, false);
  assert.ok(report.missingConfiguration.length > 0);
});
