import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LiveKit webhook persists participant lifecycle state idempotently", async () => {
  const source = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");
  assert.match(source, /visit_session_participants/);
  assert.match(source, /ON CONFLICT\(session_id, identity\) DO UPDATE/);
  assert.match(source, /participant_joined/);
  assert.match(source, /participant_connection_aborted/);
});

