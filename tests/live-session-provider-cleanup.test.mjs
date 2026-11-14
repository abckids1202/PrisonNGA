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

test("staff live-session close stops an active governed recording before room deletion", () => {
  assert.match(endRoute, /FROM recordings/);
  assert.match(endRoute, /status = 'PROCESSING'/);
  assert.match(endRoute, /stopLiveKitRecording/);
  assert.match(endRoute, /before closing the room/);
});

test("scheduled expiry stops an active recording egress before closing the room", () => {
  assert.match(worker, /recording_provider_reference/);
  assert.match(worker, /stopLiveKitRecording/);
  assert.match(worker, /recording_status === "PROCESSING"/);
});
