import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("no-show reconciliation ignores stale visitor and prisoner presence", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

  assert.match(source, /w\.visitor_presence = 'present' AND w\.visitor_presence_at >= datetime\('now', '-3 minutes'\)/);
  assert.match(source, /w\.prisoner_presence = 'present' AND w\.prisoner_presence_at >= datetime\('now', '-3 minutes'\)/);
  assert.doesNotMatch(source, /COALESCE\(w\.visitor_presence, 'absent'\) <> 'present'/);
  assert.doesNotMatch(source, /COALESCE\(w\.prisoner_presence, 'waiting'\) <> 'present'/);
});
