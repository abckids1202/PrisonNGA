import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");

test("LiveKit webhooks cannot mutate local-test sessions or sessions from another provider", () => {
  assert.match(route, /config\.provider !== "livekit"/);
  assert.match(route, /WHERE vs\.provider_room_name = \? AND vs\.provider = \?/);
  assert.match(route, /\.bind\(roomName, config\.provider\)/);
});

test("LiveKit webhooks fail closed for disabled organizations", () => {
  assert.match(route, /INNER JOIN organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/g);
});
