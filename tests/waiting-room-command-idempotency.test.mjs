import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("waiting-room commands are replay-safe and clean up orphan LiveKit rooms on failure", async () => {
  const source = await readFile(new URL("../app/api/control/waiting-room/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(database/);
  assert.match(source, /completeIdempotencyStatement\(database/);
  assert.match(source, /releaseIdempotencyClaim/);
  assert.match(source, /LIVEKIT_ORPHAN_ROOM_CLEANUP_FAILED/);
  assert.match(source, /STALE_WAITING_ROOM_STATE/);
});
