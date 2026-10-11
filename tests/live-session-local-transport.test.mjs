import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const visitorRoute = await readFile(new URL("../app/api/visitor/visits/[visitId]/live-session/route.ts", import.meta.url), "utf8");
const kioskRoute = await readFile(new URL("../app/api/kiosk/visits/[visitId]/live-session/route.ts", import.meta.url), "utf8");
const client = await readFile(new URL("../app/features/live-session/LiveSessionClient.tsx", import.meta.url), "utf8");

test("live-session token responses identify the provider", () => {
  assert.match(visitorRoute, /provider: config\.provider/);
  assert.match(kioskRoute, /provider: config\.provider/);
});

test("development video transport never sends the invalid local URL to LiveKit", () => {
  assert.match(client, /provider === "local_test"/);
  assert.match(client, /setDevelopmentTransport\(true\)/);
  assert.match(client, /Development transport · no media provider connected/);
  assert.match(client, /await connectRoom\(serverUrl, token\)/);
});

test("local development sessions are visibly distinct from real live media", () => {
  assert.match(client, /developmentTransport \? "TEST" : "LIVE"/);
  assert.match(client, /Local test transport/);
  assert.match(client, /Local preview placeholder/);
});
