import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationRunner = path.join(projectRoot, "scripts", "d1-migrations.mjs");
const temporaryStateDir = await mkdtemp(path.join(os.tmpdir(), "securevisit-d1-fresh-"));

try {
  for (const [label, action] of [
    ["Apply all migrations to an empty local D1 database", "apply"],
    ["Confirm the fresh database has no pending migrations", "list"],
    ["Seed fictional baseline facility data", "seed"],
  ]) {
    console.log(`\n${label}`);
    const result = spawnSync(process.execPath, [migrationRunner, action, "--local"], {
      cwd: projectRoot,
      env: { ...process.env, SECUREVISIT_LOCAL_D1_STATE_DIR: temporaryStateDir },
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }

  console.log("\nFresh local D1 migration and seed verification passed.");
} finally {
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedStateDir = path.resolve(temporaryStateDir);
  if (!resolvedStateDir.startsWith(`${tempRoot}${path.sep}`)) {
    throw new Error("Refusing to remove a temporary database path outside the OS temporary directory.");
  }
  await rm(resolvedStateDir, { recursive: true, force: true });
}
