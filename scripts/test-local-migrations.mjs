import { mkdtemp, readFile, rm } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
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
    ["Repeat the fictional baseline seed without tenant conflicts", "seed"],
  ]) {
    console.log(`\n${label}`);
    // Wrangler can emit a migration table larger than Windows' synchronous
    // child-process pipe buffer. Spool output to temporary files so a schema
    // growth cannot turn a valid migration into an ENOBUFS verification
    // failure; diagnostics are still read back when a command fails.
    const stdoutPath = path.join(temporaryStateDir, `${action}.stdout.log`);
    const stderrPath = path.join(temporaryStateDir, `${action}.stderr.log`);
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    let result;
    try {
      result = spawnSync(process.execPath, [migrationRunner, action, "--local"], {
        cwd: projectRoot,
        env: { ...process.env, SECUREVISIT_LOCAL_D1_STATE_DIR: temporaryStateDir },
        stdio: ["ignore", stdoutFd, stderrFd],
        windowsHide: true,
      });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const diagnostics = [await readFile(stdoutPath, "utf8"), await readFile(stderrPath, "utf8")]
        .filter((output) => output.length)
        .map((output) => output.trim())
        .join("\n\n");
      throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.\n${diagnostics}`);
    }
    console.log(`✓ ${label}`);
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
