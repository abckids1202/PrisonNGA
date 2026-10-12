import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localPlaceholder = "00000000-0000-4000-8000-000000000000";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (process.argv.includes("--help")) {
  console.log("Usage: npm run db:seed:staging -- --confirm-staging-fixture [--bootstrap-staff-email=operator@example.org]");
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
const bootstrapEmailArgument = process.argv.find((argument) => argument.startsWith("--bootstrap-staff-email="));
const bootstrapEmail = bootstrapEmailArgument ? bootstrapEmailArgument.slice("--bootstrap-staff-email=".length).trim().toLowerCase() : "";
const bootstrapNameArgument = process.argv.find((argument) => argument.startsWith("--bootstrap-staff-name="));
const bootstrapName = bootstrapNameArgument ? bootstrapNameArgument.slice("--bootstrap-staff-name=".length).trim() : "Staging Supervisor";
const bootstrapReferenceArgument = process.argv.find((argument) => argument.startsWith("--bootstrap-staff-reference="));
const bootstrapReference = bootstrapReferenceArgument ? bootstrapReferenceArgument.slice("--bootstrap-staff-reference=".length).trim() : "STAGING-BOOTSTRAP";
if (bootstrapEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrapEmail)) throw new Error("--bootstrap-staff-email must be a valid operator email address.");
if ((bootstrapNameArgument || bootstrapReferenceArgument) && !bootstrapEmail) throw new Error("Bootstrap staff name/reference require --bootstrap-staff-email.");
if (bootstrapName.length < 2 || bootstrapName.length > 160 || bootstrapReference.length < 2 || bootstrapReference.length > 40) throw new Error("Bootstrap staff name/reference length is invalid.");
const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
if (!uuidPattern.test(databaseId) || databaseId === localPlaceholder) {
  throw new Error("D1_DATABASE_ID must be a real Cloudflare D1 UUID; the local placeholder is refused.");
}
if (!databaseName || databaseName.length > 64) throw new Error("D1_DATABASE_NAME is required and must be short.");

const configDirectory = path.join(projectRoot, ".wrangler");
const configPath = path.join(configDirectory, `d1-staging-fixture-${process.pid}.jsonc`);
const bootstrapSqlPath = path.join(configDirectory, `d1-staging-bootstrap-${process.pid}.sql`);
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
  if ((result.status ?? 1) !== 0) throw new Error(`Staging fixture failed with exit code ${result.status ?? "unknown"}.`);
  if (bootstrapEmail) {
    const bootstrapSql = `INSERT OR IGNORE INTO users (id, external_id, email, display_name, user_type, status, version, created_at, updated_at)\nVALUES ('staff-staging-bootstrap', 'pending:staff-staging-bootstrap', ${sqlLiteral(bootstrapEmail)}, ${sqlLiteral(bootstrapName)}, 'STAFF', 'ACTIVE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);\n\nINSERT OR IGNORE INTO staff_profiles (user_id, facility_id, employee_reference, job_title, department)\nVALUES ('staff-staging-bootstrap', 'facility-staging-001', ${sqlLiteral(bootstrapReference)}, 'Staging Supervisor', 'Operations');\n\nINSERT OR IGNORE INTO user_roles (user_id, role_id, facility_id, assigned_by)\nVALUES ('staff-staging-bootstrap', 'role-supervisor', 'facility-staging-001', NULL);\n`;
    await writeFile(bootstrapSqlPath, bootstrapSql, { flag: "wx" });
    const bootstrapResult = spawnSync(process.execPath, [wranglerCli, "d1", "execute", "DB", "--remote", "--file", bootstrapSqlPath, "--config", configPath], { cwd: projectRoot, stdio: "inherit" });
    if (bootstrapResult.error) throw bootstrapResult.error;
    if ((bootstrapResult.status ?? 1) !== 0) throw new Error(`Bootstrap staff insert failed with exit code ${bootstrapResult.status ?? "unknown"}.`);
  }
} finally {
  await rm(configPath, { force: true });
  await rm(bootstrapSqlPath, { force: true });
}
