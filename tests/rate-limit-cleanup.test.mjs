import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { purgeStaleRateLimitBuckets } from "../lib/server/rate-limit-cleanup.ts";

test("rate-limit cleanup removes only inactive buckets", async () => {
  const database = new DatabaseSync(":memory:");
  const d1 = { prepare(sql) { return { async run() { const result = database.prepare(sql).run(); return { meta: { changes: Number(result.changes) } }; } }; } };
  database.exec(`CREATE TABLE rate_limit_buckets (key_hash TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL, request_count INTEGER NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO rate_limit_buckets VALUES ('old', 1, 4, '2000-01-01T00:00:00.000Z'), ('recent', 2, 1, '2999-01-01T00:00:00.000Z');`);
  await purgeStaleRateLimitBuckets(d1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM rate_limit_buckets").get().count, 1);
  assert.equal(database.prepare("SELECT key_hash FROM rate_limit_buckets").get().key_hash, "recent");
});

test("worker schedules rate-limit cleanup", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /purgeStaleRateLimitBuckets\(env\.DB\)/);
});
