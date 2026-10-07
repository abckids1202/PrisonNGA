import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.SECUREVISIT_E2E_ISOLATED === "true";
const isolatedStatePath = isolated ? await mkdtemp(path.join(os.tmpdir(), "securevisit-e2e-state-")) : null;
const childEnvironment = isolatedStatePath ? { ...process.env, SECUREVISIT_LOCAL_D1_STATE_DIR: isolatedStatePath } : process.env;
// The normal browser suite talks to the same persisted local D1 state as
// `vinext dev`. Release verification opts into an isolated disposable state so
// it can run while a developer's local server is open.
// Apply migrations first so a developer cannot mistake a stale local schema for
// a workflow or API regression.
const migrationScript = path.join(projectRoot, "scripts", "d1-migrations.mjs");
try {
  const migration = spawnSync(process.execPath, ["--env-file-if-exists=.env.local", migrationScript, "apply", "--local"], { cwd: projectRoot, stdio: "inherit", env: childEnvironment });
  if (migration.error) throw migration.error;
  if (migration.status !== 0) process.exit(migration.status ?? 1);
  if (isolatedStatePath) {
    const seed = spawnSync(process.execPath, ["--env-file-if-exists=.env.local", migrationScript, "seed", "--local"], { cwd: projectRoot, stdio: "inherit", env: childEnvironment });
    if (seed.error) throw seed.error;
    if (seed.status !== 0) process.exit(seed.status ?? 1);
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
