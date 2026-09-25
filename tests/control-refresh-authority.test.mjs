import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Control workspace refreshes appointments and facility state from protected APIs", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /fetch\("\/api\/control\/appointments"[\s\S]*cache: "no-store"/);
  assert.match(source, /fetch\("\/api\/facility\/state"[\s\S]*credentials: "include", cache: "no-store"/);
  assert.match(source, /setInterval\(\(\) => \{ void loadAppointments\(\); \}, 15000\)/);
  assert.match(source, /setInterval\(\(\) => \{ void loadFacilityState\(\); \}, 15000\)/);
  assert.match(source, /setBackendStatus\("unavailable"\)/);
});
