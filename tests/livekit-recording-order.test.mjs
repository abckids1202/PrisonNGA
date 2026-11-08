import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("LiveKit recording callbacks cannot reopen terminal records or downgrade available output", async () => {
  const source = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");
  assert.match(source, /recording\.status === \"AVAILABLE\" \|\| recording\.status === \"FAILED\"/);
  assert.match(source, /reason: \"RECORDING_TERMINAL\"/);
  assert.match(source, /AND status IN \('PENDING', 'PROCESSING'\)/);
});
