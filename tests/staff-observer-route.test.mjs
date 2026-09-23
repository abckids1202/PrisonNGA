import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staff observer route requests a restricted server token and mounts the read-only client", async () => {
  const source = await readFile(new URL("../app/features/live-session/StaffObserverRouteClient.tsx", import.meta.url), "utf8");
  assert.match(source, /observer-token/);
  assert.match(source, /Routine live-session observation/);
  assert.match(source, /StaffObserverClient/);
  assert.match(source, /credentials: "include"/);
});

