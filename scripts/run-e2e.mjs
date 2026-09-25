import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The browser suite talks to the same persisted local D1 state as `vinext dev`.
// Apply migrations first so a developer cannot mistake a stale local schema for
// a workflow or API regression. Seeding remains explicit and is intentionally
// not performed here because the seed contains fictional facility fixtures.
const migrationScript = path.join(projectRoot, "scripts", "d1-migrations.mjs");
const migration = spawnSync(process.execPath, ["--env-file-if-exists=.env.local", migrationScript, "apply", "--local"], { cwd: projectRoot, stdio: "inherit", env: process.env });
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exit(migration.status ?? 1);

const playwrightCli = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");
const result = spawnSync(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], { cwd: projectRoot, stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
