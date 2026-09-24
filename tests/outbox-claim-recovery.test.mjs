import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("outbox recovery uses processing claim age and clears claims on every worker outcome", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /processing_started_at IS NOT NULL AND processing_started_at < datetime\('now', '-5 minutes'\)/);
  assert.match(source, /processing_started_at = CURRENT_TIMESTAMP/);
  assert.match(source, /status = 'PROCESSED', processing_started_at = NULL/);
  assert.match(source, /processing_started_at = NULL, last_error = \?/);
});

test("outbox claims before parsing so malformed payloads enter retry/dead-letter handling", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const worker = source.slice(source.indexOf("async function processOutbox"));
  const claim = worker.indexOf("const claim = await env.DB.prepare(\"UPDATE outbox_events SET status = 'PROCESSING'");
  const parse = worker.indexOf("const payload = JSON.parse(row.payload)");
  assert.ok(claim >= 0, "outbox claim is present");
  assert.ok(parse > claim, "payload parsing must happen after the processing claim");
});
