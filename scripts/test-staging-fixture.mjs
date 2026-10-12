import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localDatabaseId = "00000000-0000-4000-8000-000000000000";
const temporaryStateDir = await mkdtemp(path.join(os.tmpdir(), "securevisit-staging-fixture-"));
const configDirectory = path.join(projectRoot, ".wrangler");
const configPath = path.join(configDirectory, `staging-fixture-test-${process.pid}.jsonc`);
const wranglerCli = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function run(args, label, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).map((value) => value.toString().trim()).join("\n\n");
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.\n${output}`);
  }
}

try {
  run([path.join(projectRoot, "scripts", "d1-migrations.mjs"), "apply", "--local"], "fresh local migrations", { SECUREVISIT_LOCAL_D1_STATE_DIR: temporaryStateDir });
  await mkdir(configDirectory, { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ name: "securevisit-staging-fixture-test", compatibility_date: "2026-09-22", d1_databases: [{ binding: "DB", database_name: "securevisit-fixture-test", database_id: localDatabaseId, migrations_dir: "../drizzle" }] }, null, 2)}\n`, { flag: "wx" });
  run([wranglerCli, "d1", "execute", "DB", "--local", "--file", path.join(projectRoot, "db", "staging-fixture.sql"), "--config", configPath, "--persist-to", temporaryStateDir], "staging fixture SQL");
  run([wranglerCli, "d1", "execute", "DB", "--local", "--command", "SELECT id FROM facilities WHERE id = 'facility-staging-001';", "--config", configPath, "--persist-to", temporaryStateDir], "staging fixture verification");
  console.log("Staging fixture schema verification passed.");
} finally {
  await rm(configPath, { force: true });
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedStateDir = path.resolve(temporaryStateDir);
  if (!resolvedStateDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error("Refusing to remove a temporary database path outside the OS temporary directory.");
  await rm(resolvedStateDir, { recursive: true, force: true });
}
