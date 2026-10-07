import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LiveKit control-plane requests have bounded timeout and failover", async () => {
  const source = await readFile(new URL("../lib/server/video/provider.ts", import.meta.url), "utf8");
  assert.match(source, /requestTimeout: 8/);
  assert.match(source, /failover: true/);
});
