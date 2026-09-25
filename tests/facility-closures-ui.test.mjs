import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const component = await readFile(new URL("../app/components/FacilityClosures.tsx", import.meta.url), "utf8");

test("Facility management exposes the persisted closure workflow", () => {
  assert.match(page, /import FacilityClosures from "\.\/components\/FacilityClosures"/);
  assert.match(page, /tab === "Closures" \? <FacilityClosures \/>/);
  assert.match(component, /\/api\/control\/facility-closures/);
  assert.match(component, /Idempotency-Key/);
  assert.match(component, /Create closure/);
  assert.match(component, /Cancel closure/);
});
