import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("evidence retention restores legal-hold rows in bounded batches", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const retention = worker.slice(worker.indexOf("async function purgeExpiredEvidence"), worker.indexOf("async function purgeExpiredStepUpAssertions"));
  assert.match(retention, /UPDATE evidence_documents SET status = 'AVAILABLE'/);
  assert.match(retention, /WHERE rowid IN \(/);
  assert.match(retention, /LIMIT 50/);
});
