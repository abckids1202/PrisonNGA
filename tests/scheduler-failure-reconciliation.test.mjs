import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("no-show reconciliation ignores stale visitor and prisoner presence", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

  assert.match(source, /julianday\(a\.requested_end\) <= julianday\('now'\)/);
  assert.match(source, /w\.visitor_presence = 'present' AND julianday\(w\.visitor_presence_at\) >= julianday\('now', '-3 minutes'\)/);
  assert.match(source, /w\.prisoner_presence = 'present' AND julianday\(w\.prisoner_presence_at\) >= julianday\('now', '-3 minutes'\)/);
  assert.doesNotMatch(source, /COALESCE\(w\.visitor_presence, 'absent'\) <> 'present'/);
  assert.doesNotMatch(source, /COALESCE\(w\.prisoner_presence, 'waiting'\) <> 'present'/);
});

test("scheduled cleanup normalizes ISO timestamps before comparing SQLite clock values", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const cleanup = await readFile(new URL("../lib/server/auth/cleanup.ts", import.meta.url), "utf8");

  assert.match(source, /julianday\(created_at\) <= julianday\('now', '-30 minutes'\)/);
  assert.match(source, /julianday\(retention_until\) <= julianday\('now'\)/);
  assert.match(source, /julianday\(vs\.authorized_end_at\) <= julianday\('now'\)/);
  assert.match(cleanup, /julianday\(expires_at\) <= julianday\('now'\)/);
  assert.match(cleanup, /julianday\(created_at\) <= julianday\('now', '-1 day'\)/);
});
