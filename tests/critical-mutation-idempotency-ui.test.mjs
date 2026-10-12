import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("critical staff mutations use deterministic entity/version idempotency keys", async () => {
  const shell = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const waiting = await readFile(new URL("../app/features/control/WaitingRoomPage.tsx", import.meta.url), "utf8");
  const resources = await readFile(new URL("../app/features/resources/ResourcesPage.tsx", import.meta.url), "utf8");

  assert.match(shell, /facility-state:\$\{nextState\}:\$\{facilityVersion\}`/);
  assert.match(shell, /appointment-decision-\$\{id\}-\$\{command\}-\$\{appointment\.version\}`/);
  assert.match(shell, /resource-reassign:\$\{input\.appointmentId\}:\$\{input\.sourceResourceId\}:\$\{input\.expectedSourceVersion\}:\$\{input\.targetResourceId\}:\$\{input\.expectedTargetVersion\}:\$\{input\.expectedWaitingVersion\}`/);
  assert.match(waiting, /waiting-room-\$\{record\.id\}-\$\{record\.backendVersion\}-\$\{command\}`/);
  assert.match(resources, /resource-status-\$\{resource\.id\}-\$\{resource\.version\}-\$\{nextStatus\}`/);
});
