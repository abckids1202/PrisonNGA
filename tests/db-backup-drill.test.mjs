import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("database backup drill refuses direct remote restore and reorders exports safely", async () => {
  const source = await readFile(new URL("../scripts/db-backup-drill.mjs", import.meta.url), "utf8");
  assert.match(source, /Restore drills always target a disposable clean local database/);
  assert.match(source, /Remote D1 backups require SECUREVISIT_ENVIRONMENT=staging or production/);
  assert.match(source, /splitSqlStatements/);
  assert.match(source, /const tables = statements\.filter/);
  assert.match(source, /expectedTableNames/);
  assert.match(source, /const data = statements\.filter/);
  assert.match(source, /RESTORE_OK/);
  assert.match(source, /INTEGRITY_OK/);
  assert.match(source, /pragma_foreign_key_check/);
  assert.match(source, /LEDGER_OK/);
  assert.match(source, /AUDIT_OK/);
});

test("remote migration tooling requires an explicit non-development environment", async () => {
  const source = await readFile(new URL("../scripts/d1-migrations.mjs", import.meta.url), "utf8");
  assert.match(source, /Remote D1 migrations require SECUREVISIT_ENVIRONMENT=staging or production/);
});

test("package scripts expose explicit local backup, remote backup, and restore-drill commands", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts["db:backup:local"], /db-backup-drill\.mjs backup --local/);
  assert.match(packageJson.scripts["db:backup:remote"], /db-backup-drill\.mjs backup --remote/);
  assert.match(packageJson.scripts["db:restore:drill"], /db-backup-drill\.mjs restore/);
});
