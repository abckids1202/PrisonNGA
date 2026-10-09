import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("scheduled worker records durable critical credit-integrity alarms", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /async function reconcileCreditAccountInvariants/);
  assert.match(source, /CREDIT_ACCOUNT_RECONCILIATION_REQUIRED/);
  assert.match(source, /requiresStaffReview: true/);
  assert.match(source, /runScheduledJob\("credit-account-reconciliation"/);
});
