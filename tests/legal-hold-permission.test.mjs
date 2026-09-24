import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("legal-hold mutations use a dedicated least-privilege permission", async () => {
  const source = await readFile(new URL("../app/api/control/legal-holds/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0035_legal_hold_manage_permission.sql", import.meta.url), "utf8");
  assert.match(source, /requirePermission\("legal_hold\.manage"\)/);
  assert.match(source, /requirePermission\("audit\.read"\)/);
  assert.match(migration, /legal_hold\.manage/);
  assert.match(migration, /role-supervisor/);
  assert.match(migration, /role-auditor/);
});

