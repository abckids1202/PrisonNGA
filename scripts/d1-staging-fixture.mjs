import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localPlaceholder = "00000000-0000-4000-8000-000000000000";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (process.argv.includes("--help")) {
  console.log("Usage: npm run db:seed:staging -- --confirm-staging-fixture");
  process.exit(0);
}

if (!process.argv.includes("--confirm-staging-fixture")) {
  throw new Error("Refusing to seed staging without --confirm-staging-fixture.");
}

if (String(process.env.SECUREVISIT_ENVIRONMENT || "").trim().toLowerCase() !== "staging") {
  throw new Error("The staging fixture can run only with SECUREVISIT_ENVIRONMENT=staging.");
}

const databaseId = String(process.env.D1_DATABASE_ID || "").trim();
const databaseName = String(process.env.D1_DATABASE_NAME || "securevisit").trim();
if (!uuidPattern.test(databaseId) || databaseId === localPlaceholder) {
  throw new Error("D1_DATABASE_ID must be a real Cloudflare D1 UUID; the local placeholder is refused.");
}
if (!databaseName || databaseName.length > 64) throw new Error("D1_DATABASE_NAME is required and must be short.");

const configDirectory = path.join(projectRoot, ".wrangler");
const configPath = path.join(configDirectory, `d1-staging-fixture-${process.pid}.jsonc`);
const config = {
  name: "securevisit-staging-fixture",
  compatibility_date: "2026-09-22",
  d1_databases: [{ binding: "DB", database_name: databaseName, database_id: databaseId, migrations_dir: "../drizzle" }],
};

await mkdir(configDirectory, { recursive: true });
await rm(configPath, { force: true });
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
try {
  const wranglerCli = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wranglerCli, "d1", "execute", "DB", "--remote", "--file", path.join(projectRoot, "db", "staging-fixture.sql"), "--config", configPath], { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(configPath, { force: true });
}
