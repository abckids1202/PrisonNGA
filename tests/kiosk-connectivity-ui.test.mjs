import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/kiosk/visits/[visitId]/KioskPreparationClient.tsx", import.meta.url), "utf8");

test("kiosk preparation reports the persisted heartbeat result instead of claiming connectivity", () => {
  assert.match(source, /setConnectionState\(response\.ok \? "connected" : "unavailable"\)/);
  assert.match(source, /Connection unavailable/);
  assert.match(source, /Checking connection/);
  assert.match(source, /sv-kiosk-live-dot \$\{connectionState !== "connected" \? "offline" : ""\}/);
});
