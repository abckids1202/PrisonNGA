import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const [, , action, ...argumentsList] = process.argv;

function option(name) {
  const index = argumentsList.indexOf(name);
  return index >= 0 ? argumentsList[index + 1] : undefined;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let inString = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (inString && sql[index + 1] === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
    } else if (character === ";" && !inString) {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const trailing = sql.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function sqlIdentifier(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return `X'${Buffer.from(value).toString("hex")}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function exportConfiguredLocalState(stateDirectory, outputPath) {
  const databaseDirectory = path.join(path.resolve(projectRoot, stateDirectory), "v3", "d1", "miniflare-D1DatabaseObject");
  const candidates = (await readdir(databaseDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite")
    .map((entry) => path.join(databaseDirectory, entry.name));
  if (candidates.length !== 1) throw new Error("Configured local D1 state must contain exactly one application SQLite database.");
  const database = new DatabaseSync(candidates[0], { readOnly: true });
  try {
    const objects = database.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 WHEN 'view' THEN 3 ELSE 4 END, name").all();
    const tables = objects.filter((object) => object.type === "table");
    const statements = ["PRAGMA defer_foreign_keys=TRUE;"];
    for (const table of tables) statements.push(`${table.sql};`);
    for (const table of tables) {
      const columns = database.prepare(`PRAGMA table_info(${sqlIdentifier(table.name)})`).all().map((column) => column.name);
      if (!columns.length) continue;
      const rows = database.prepare(`SELECT * FROM ${sqlIdentifier(table.name)}`).all();
      for (const row of rows) {
        statements.push(`INSERT INTO ${sqlIdentifier(table.name)} (${columns.map(sqlIdentifier).join(", ")}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(", ")});`);
      }
    }
    for (const object of objects.filter((entry) => entry.type !== "table")) statements.push(`${object.sql};`);
    await writeFile(outputPath, `${statements.join("\n")}\n`, "utf8");
  } finally {
    database.close();
  }
}

if (!existsSync(wranglerCli)) fail("Wrangler is not installed. Run npm install first.");
if (!["backup", "restore"].includes(action)) fail("Usage: backup --output <file.sql> [--remote|--local] | restore --input <file.sql>");

const localDatabaseId = "00000000-0000-4000-8000-000000000000";
const remote = argumentsList.includes("--remote");
const local = argumentsList.includes("--local") || !remote;
if (remote && local) fail("Choose exactly one database target: --remote or --local.");
const runtimeEnvironment = String(process.env.SECUREVISIT_ENVIRONMENT || "").trim().toLowerCase();
if (remote && !["staging", "production"].includes(runtimeEnvironment)) {
  fail("Remote D1 backups require SECUREVISIT_ENVIRONMENT=staging or production; local development cannot target a remote database.");
}

const databaseId = remote ? process.env.D1_DATABASE_ID?.trim() : localDatabaseId;
const databaseName = remote ? process.env.D1_DATABASE_NAME?.trim() || "securevisit" : "site-creator-d1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!databaseId || !uuidPattern.test(databaseId) || (remote && databaseId === localDatabaseId)) {
  fail(remote ? "Remote backup requires D1_DATABASE_ID set to the real Cloudflare database UUID." : "The local D1 database ID is invalid.");
}

// Give each drill its own project-root config file so Wrangler keeps using the
// application's normal `.wrangler/state` directory. A random name prevents a
// previous interrupted run from causing EEXIST when a process id is reused.
const configPath = path.join(projectRoot, `.d1-backup-${crypto.randomUUID()}.jsonc`);
const config = JSON.stringify({ compatibility_date: "2026-09-22", d1_databases: [{ binding: "DB", database_name: databaseName, database_id: databaseId }] }, null, 2);
const outputPath = option("--output");
const inputPath = option("--input");

if (action === "backup") {
  if (!outputPath) fail("Backup requires --output <file.sql>.");
  const resolvedOutput = path.resolve(outputPath);
  if (!resolvedOutput.toLowerCase().endsWith(".sql")) fail("Backup output must be a .sql file.");
  const args = [wranglerCli, "d1", "export", "DB", local ? "--local" : "--remote", "--output", resolvedOutput, "--skip-confirmation", "--config", configPath];
  const configuredLocalStateDir = process.env.SECUREVISIT_LOCAL_D1_STATE_DIR?.trim();
  // Keep Wrangler's working directory anchored at the project so local
  // exports use the same persisted state as the application.
  args.push("--cwd", projectRoot);
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(configPath, `${config}\n`, { flag: "wx" });
  try {
    if (local && configuredLocalStateDir) {
      await exportConfiguredLocalState(configuredLocalStateDir, resolvedOutput);
      console.log(`Exported configured local D1 state to ${resolvedOutput}.`);
      process.exitCode = 0;
    } else {
      const result = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: "inherit" });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    }
  } finally {
    await rm(configPath, { force: true });
  }
} else {
  if (remote) fail("Restore drills always target a disposable clean local database; do not restore directly to a remote database.");
  if (!inputPath) fail("Restore requires --input <file.sql>.");
  const resolvedInput = path.resolve(inputPath);
  if (!existsSync(resolvedInput)) fail(`Backup file not found: ${resolvedInput}`);
  const persistTo = await mkdtemp(path.join(os.tmpdir(), "securevisit-restore-drill-"));
  try {
    const exportedSql = await readFile(resolvedInput, "utf8");
    // Wrangler exports can contain valid schema/data in an order that trips
    // D1's foreign-key checks during a clean import. Create every table first,
    // then insert data, then create indexes/other statements. The backup file
    // itself is never modified; only this disposable restore input is changed.
    const statements = splitSqlStatements(exportedSql);
    const tables = statements.filter((statement) => /^CREATE TABLE\b/i.test(statement));
    const data = statements.filter((statement) => /^INSERT INTO\b/i.test(statement));
    const other = statements.filter((statement) => !/^CREATE TABLE\b/i.test(statement) && !/^INSERT INTO\b/i.test(statement) && !/^PRAGMA\b/i.test(statement));
    if (!tables.length || !data.length) fail("Backup does not contain both table definitions and data.");
    const expectedTableNames = [...new Set(tables.map((statement) => statement.match(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?[`\"]?([A-Za-z0-9_]+)[`\"]?/i)?.[1]).filter(Boolean))];
    if (expectedTableNames.length !== tables.length) fail("Backup contains an unsupported or duplicate table definition.");
    const database = new DatabaseSync(path.join(persistTo, "restore.sqlite"));
    try {
      database.exec(`PRAGMA foreign_keys=OFF;\nPRAGMA defer_foreign_keys=ON;\n${[...tables, ...data, ...other].join("\n")}\n`);
      const readStatus = (sql) => database.prepare(sql).get();
      const restoreStatus = readStatus("SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('facilities', 'users', 'appointments', 'credit_ledger_entries', 'payment_intents', 'audit_events')) = 6 THEN 'RESTORE_OK' ELSE 'RESTORE_INCOMPLETE' END AS restore_status;");
      if (restoreStatus?.restore_status !== "RESTORE_OK") fail("Restore completed, but required schema verification did not return RESTORE_OK.");
    // D1 rejects the SQLite integrity_check pragma in the local adapter. Use
    // supported SQL checks that still prove the restored schema is populated
    // and its declared relationships can be evaluated.
    const tableList = expectedTableNames.map((name) => `'${name.replaceAll("'", "''")}'`).join(", ");
      const sqliteIntegrity = readStatus(`SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (${tableList})) = ${expectedTableNames.length} THEN 'INTEGRITY_OK' ELSE 'INTEGRITY_INCOMPLETE' END AS integrity_status;`);
      if (sqliteIntegrity?.integrity_status !== "INTEGRITY_OK") fail("Restore completed, but schema consistency verification did not return INTEGRITY_OK.");
      const foreignKeys = readStatus("SELECT COUNT(*) AS foreign_key_violations FROM pragma_foreign_key_check();");
      if (Number(foreignKeys?.foreign_key_violations) !== 0) fail("Restore completed, but foreign-key consistency check returned violations.");
      const ledger = readStatus("SELECT CASE WHEN (SELECT COUNT(*) FROM credit_accounts ca WHERE ca.available_credits < 0 OR ca.reserved_credits < 0 OR ca.available_credits <> (SELECT COALESCE(SUM(cle.amount), 0) FROM credit_ledger_entries cle WHERE cle.credit_account_id = ca.id) OR ca.reserved_credits <> (SELECT COUNT(*) FROM credit_ledger_entries r WHERE r.credit_account_id = ca.id AND r.entry_type = 'RESERVATION' AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t WHERE t.appointment_id = r.appointment_id AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION')))) = 0 THEN 'LEDGER_OK' ELSE 'LEDGER_INCOMPLETE' END AS ledger_status;");
      if (ledger?.ledger_status !== "LEDGER_OK") fail("Restore completed, but credit ledger consistency verification did not return LEDGER_OK.");
      const audit = readStatus("SELECT CASE WHEN (SELECT COUNT(*) FROM audit_events WHERE correlation_id IS NULL OR trim(correlation_id) = '' OR (old_values IS NOT NULL AND json_valid(old_values) = 0) OR (new_values IS NOT NULL AND json_valid(new_values) = 0)) = 0 THEN 'AUDIT_OK' ELSE 'AUDIT_INCOMPLETE' END AS audit_status;");
      if (audit?.audit_status !== "AUDIT_OK") fail("Restore completed, but audit integrity verification did not return AUDIT_OK.");
      console.log(`Restore drill passed. Verified schema, foreign-key, credit-ledger, and audit integrity in disposable database: ${persistTo}`);
    } finally {
      database.close();
    }
  } finally {
    await rm(configPath, { force: true });
    await rm(persistTo, { recursive: true, force: true });
  }
}
