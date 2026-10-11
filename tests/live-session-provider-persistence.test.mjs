import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/control/waiting-room/route.ts", import.meta.url), "utf8");

test("starting a visit persists the selected video provider on the session", () => {
  assert.match(route, /getVideoConfig/);
  assert.match(route, /provider: videoConfig\.provider/);
  assert.match(route, /\.bind\(newSession\.id, body\.appointmentId, authorization\.facilityId, newSession\.provider/);
  assert.doesNotMatch(route, /authorization\.facilityId, "livekit", newSession\.roomName/);
});
