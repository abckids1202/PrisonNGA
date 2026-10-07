import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor Home device-check action opens the persisted next visit", async () => {
  const source = await readFile(new URL("../app/visitor/page.tsx", import.meta.url), "utf8");
  assert.match(source, /title="Device check"[^\n]+onClick=\{nextVisit \? onOpenVisit/);
  assert.match(source, /Schedule a visit first, then you can run the device check from Visit Details/);
});

test("device-check summary only claims readiness when every visitor check passes", async () => {
  const source = await readFile(new URL("../app/visitor/visits/[visitId]/device-check/page.tsx", import.meta.url), "utf8");
  assert.match(source, /cameraStatus === "ready" && microphoneStatus === "ready"/);
  assert.match(source, /\["stable", "fair"\]\.includes\(network\.rating\)/);
  assert.match(source, /warnings and an unknown network/);
});
