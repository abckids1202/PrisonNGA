import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("scheduled maintenance isolates named jobs and records failures", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /backgroundEnvironmentReady\(env, "scheduled"\)/);
  assert.match(source, /BACKGROUND_ENVIRONMENT_VALIDATION_FAILED/);
  assert.match(source, /async function runScheduledJob\(env: Env, name: string, task: \(\) => Promise<void>\)/);
  assert.match(source, /await task\(\)/);
  assert.match(source, /event: "SCHEDULED_JOB_FAILED"/);
  assert.match(source, /jobName: name/);
  assert.match(source, /recordScheduledJobFailure\(env, name, error\)/);
  assert.match(source, /SELECT id FROM facilities/);
  assert.match(source, /env\.DB\.batch\(facilities\.results\.map/);
  assert.match(source, /crypto\.randomUUID\(\), facility\.id/);
  assert.match(source, /CASE WHEN json_valid\(se\.metadata\) = 1[\s\S]*json_extract\(se\.metadata, '\$\.jobName'\)/);
  assert.match(source, /runScheduledJob\(env, "payment-events", \(\) => reconcilePaymentEvents\(env\)\)/);
  assert.match(source, /runScheduledJob\(env, "live-session-reconciliation", \(\) => reconcileExpiredSessions\(env\)\)/);
  assert.match(source, /ctx\.waitUntil\(Promise\.all\(\[/);
});
