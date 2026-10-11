import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const session = await readFile(new URL("../lib/server/video/session.ts", import.meta.url), "utf8");
const visitor = await readFile(new URL("../app/api/visitor/visits/[visitId]/live-session/route.ts", import.meta.url), "utf8");
const kiosk = await readFile(new URL("../app/api/kiosk/visits/[visitId]/live-session/route.ts", import.meta.url), "utf8");
const observer = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/observer-token/route.ts", import.meta.url), "utf8");

test("live-session token issuance fails closed when the configured provider differs from the persisted room provider", () => {
  assert.match(session, /VIDEO_PROVIDER_MISMATCH/);
  assert.match(visitor, /assertSessionProvider\(session, config\.provider\)/);
  assert.match(kiosk, /assertSessionProvider\(sessionRecord, config\.provider\)/);
  assert.match(observer, /assertSessionProvider\(session, config\.provider\)/);
});
