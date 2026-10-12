import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("step-up assertion expiry is bounded per scheduled run", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const cleanup = worker.slice(worker.indexOf("async function purgeExpiredStepUpAssertions"), worker.indexOf("async function expireBreakGlassRequests"));
  assert.match(cleanup, /DELETE FROM step_up_assertions/);
  assert.match(cleanup, /WHERE rowid IN \(/);
  assert.match(cleanup, /LIMIT 250/);
});
