import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor credit ledger reads require matching active tenant scope", async () => {
  const source = await readFile(new URL("../app/api/visitor/credits/route.ts", import.meta.url), "utf8");
  assert.match(source, /FROM credit_ledger_entries cle INNER JOIN credit_accounts ca ON ca\.id = cle\.credit_account_id/);
  assert.match(source, /INNER JOIN facilities f ON f\.id = ca\.facility_id AND f\.organization_id = ca\.organization_id/);
  assert.match(source, /INNER JOIN organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/);
  assert.match(source, /cle\.organization_id = ca\.organization_id/);
});
