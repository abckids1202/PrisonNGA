import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/visitor/availability/route.ts", import.meta.url), "utf8");
const resources = await readFile(new URL("../lib/server/resources.ts", import.meta.url), "utf8");

test("visitor availability is constrained by healthy room and kiosk capacity", () => {
  assert.match(source, /FROM resources/);
  assert.match(source, /health_state = 'HEALTHY'/);
  assert.match(source, /FROM resource_reservations/);
  assert.match(source, /hasCapacity\(cursor, end\)/);
  assert.match(resources, /r\.health_state = 'HEALTHY'/g);
});
