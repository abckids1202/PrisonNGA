import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("notification processing supports an optional queue with the durable cron fallback", () => {
  assert.match(workerSource, /NOTIFICATION_QUEUE\?: \{ send\(message: unknown\): Promise<void> \}/);
  assert.match(workerSource, /type: "OUTBOX_DRAIN"/);
  assert.match(workerSource, /NOTIFICATION_QUEUE_DISPATCH_FAILED/);
  assert.match(workerSource, /return processOutbox\(env\)/);
});

test("notification queue acknowledges only after outbox processing and retries failures", () => {
  assert.match(workerSource, /async queue\(batch: NotificationQueueBatch, env: Env\)/);
  assert.match(workerSource, /await processOutbox\(env\);[\s\S]*message\.ack\(\)/);
  assert.match(workerSource, /NOTIFICATION_QUEUE_CONSUME_FAILED/);
  assert.match(workerSource, /message\.retry\(\);[\s\S]*throw error/);
});
