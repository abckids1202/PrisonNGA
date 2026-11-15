import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const workspace = await mkdtemp(path.join(os.tmpdir(), "securevisit-release-backup-"));
const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "securevisit-release-backup-state-"));
const backupPath = path.join(workspace, "release-backup.sql");

function run(args) {
  const result = spawnSync(npmCommand, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, SECUREVISIT_LOCAL_D1_STATE_DIR: stateDirectory },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`backup drill command failed with exit code ${result.status ?? "unknown"}`);
}

try {
  // The release verifier must test a populated, disposable database. Do not
  // silently export an unrelated developer database or an empty default state.
  run(["run", "db:migrate:local"]);
  run(["run", "db:seed:local"]);
  run(["run", "db:backup:local", "--", "--output", backupPath]);
  run(["run", "db:restore:drill", "--", "--input", backupPath]);
  console.log("Local backup and disposable restore drill passed.");
} finally {
  await rm(workspace, { recursive: true, force: true });
  await rm(stateDirectory, { recursive: true, force: true });
}
