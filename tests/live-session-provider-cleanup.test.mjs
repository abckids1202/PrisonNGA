import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const endRoute = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/end/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("live-session cleanup never closes a room through a different provider", () => {
  assert.match(endRoute, /assertSessionProvider\(session, videoConfig\.provider\)/);
  assert.match(endRoute, /VIDEO_PROVIDER_MISMATCH/);
  assert.match(worker, /vs\.provider, vs\.provider_room_name/);
  assert.match(worker, /session\.provider !== videoConfig\.provider/);
  assert.match(worker, /persisted session provider differs from the configured video provider/);
});
