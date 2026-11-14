import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Browser acceptance tests must be safe to run from a developer checkout and
// deterministic in CI. An explicit opt-out is retained for debugging against
// an already prepared local database, but the default is disposable state.
const isolated = process.env.SECUREVISIT_E2E_ISOLATED !== "false";
const isolatedStatePath = isolated ? await mkdtemp(path.join(os.tmpdir(), "securevisit-e2e-state-")) : null;
const childEnvironment = isolatedStatePath
  ? {
      ...process.env,
      SECUREVISIT_LOCAL_D1_STATE_DIR: isolatedStatePath,
      SECUREVISIT_ENVIRONMENT: "development",
      VISITOR_AUTH_DELIVERY: "console",
      PAYMENT_PROVIDER: "local_test",
      PAYMENT_WEBHOOK_SECRET: "local-development-payment-webhook-secret-0123456789",
      VISIT_CREDIT_PRICE_MINOR: "50000",
      EVIDENCE_STORAGE_PROVIDER: "local_test",
    }
  : process.env;
// The normal browser suite talks to the same persisted local D1 state as
// `vinext dev`. Release verification opts into an isolated disposable state so
// it can run while a developer's local server is open.
// Apply migrations first so a developer cannot mistake a stale local schema for
// a workflow or API regression.
const migrationScript = path.join(projectRoot, "scripts", "d1-migrations.mjs");
function runSetupCommand(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: childEnvironment,
    // Wrangler prints a very large migration table to stdout. Piping that
    // stream into spawnSync can exceed Node's fixed buffer and fail with
    // ENOBUFS before Playwright starts. Keep stdout quiet; stderr remains
    // visible for actionable setup failures.
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

try {
  runSetupCommand(["--env-file-if-exists=.env.local", migrationScript, "apply", "--local"], "E2E local migrations");
  if (isolatedStatePath) {
    runSetupCommand(["--env-file-if-exists=.env.local", migrationScript, "seed", "--local"], "E2E local seed");
  }
  const playwrightCli = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");
  const result = spawnSync(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], { cwd: projectRoot, stdio: "inherit", env: childEnvironment });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (isolatedStatePath) {
    try {
      await rm(isolatedStatePath, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
    } catch (error) {
      // Playwright has already completed at this point. Windows can briefly
      // retain SQLite shared-memory files while the Worker child exits; do not
      // turn a passing browser suite into a false release failure.
      console.warn(`Could not remove temporary E2E state yet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
