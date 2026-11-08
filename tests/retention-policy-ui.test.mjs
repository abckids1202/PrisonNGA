import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("compliance exposes the persisted retention policy workflow", async () => {
  const page = await readFile(new URL("../app/features/management/CompliancePageInteractive.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../app/components/RetentionPolicyPanel.tsx", import.meta.url), "utf8");
  assert.match(page, /Retention Policies/);
  assert.match(page, /RetentionPolicyPanel/);
  assert.match(panel, /\/api\/control\/retention/);
  assert.match(panel, /Idempotency-Key/);
  assert.match(panel, /expectedVersion/);
  assert.match(panel, /step-up required/);
  assert.match(panel, /Create schedule/);
  assert.match(panel, /VISITOR_VERIFICATION/);
});
