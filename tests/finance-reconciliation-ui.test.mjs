import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Finance reconciliation UI uses the API worker status", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /data\?\.reconciliation\.workerConfigured \? "Scheduled reconciliation worker is configured"/);
  assert.match(source, /warning=\{!data\?\.reconciliation\.workerConfigured\}/);
});
