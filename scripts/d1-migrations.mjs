import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [action, target] = process.argv.slice(2);
const localDatabaseId = "00000000-0000-4000-8000-000000000000";
const validActions = new Set(["apply", "list", "seed"]);
const validTargets = new Set(["--local", "--remote"]);

if (!validActions.has(action) || !validTargets.has(target) || (action === "seed" && target !== "--local")) {
  console.error("Usage: npm run db:<migrate|migrations:list>:<local|remote> or npm run db:seed:local");
  process.exit(2);
}

const isRemote = target === "--remote";
const databaseId = isRemote ? process.env.D1_DATABASE_ID?.trim() : localDatabaseId;
const databaseName = isRemote ? process.env.D1_DATABASE_NAME?.trim() || "securevisit" : "site-creator-d1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!databaseId || !uuidPattern.test(databaseId) || (isRemote && databaseId === localDatabaseId)) {
  console.error(isRemote
    ? "Remote D1 migrations require D1_DATABASE_ID to be set to the real Cloudflare database UUID in .env.local."
    : "The configured local D1 database ID is invalid.");
  process.exit(2);
}

const configDirectory = path.join(projectRoot, ".wrangler");
const configPath = path.join(configDirectory, `d1-migrations-${process.pid}.jsonc`);
const config = {
  name: "securevisit-d1-migrations",
  compatibility_date: "2026-09-22",
  d1_databases: [{
    binding: "DB",
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: "../drizzle",
  }],
};

await mkdir(configDirectory, { recursive: true });
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });

try {
  const wranglerCli = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  const args = action === "seed"
    ? [wranglerCli, "d1", "execute", "DB", "--local", "--file", path.join(projectRoot, "db", "seed.sql"), "--config", configPath]
    : [wranglerCli, "d1", "migrations", action, "DB", target, "--config", configPath];
  const configuredLocalStateDir = process.env.SECUREVISIT_LOCAL_D1_STATE_DIR?.trim();
  const persistPath = isRemote
    ? undefined
    : configuredLocalStateDir
      ? path.resolve(projectRoot, configuredLocalStateDir)
      : path.join(projectRoot, ".wrangler", "state");
  if (persistPath) args.push("--persist-to", persistPath);

  const result = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(configPath, { force: true });
}
