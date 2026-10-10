import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deployment build reads explicit remote D1 and R2 binding configuration", async () => {
  const source = await readFile("vite.config.ts", "utf8");
  assert.match(source, /runtimeEnvironmentValue\("D1_DATABASE_ID"\)/);
  assert.match(source, /runtimeEnvironmentValue\("D1_DATABASE_NAME"\)/);
  assert.match(source, /runtimeEnvironmentValue\("EVIDENCE_BUCKET_NAME"\)/);
  assert.match(source, /database_id: configuredD1DatabaseId \|\| SITE_CREATOR_PLACEHOLDER_DATABASE_ID/);
  assert.match(source, /binding: r2 \|\| "EVIDENCE_BUCKET"/);
});
