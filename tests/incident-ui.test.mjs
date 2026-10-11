import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("incident transitions require an operator-entered action note", () => {
  assert.match(page, /Action note/);
  assert.match(page, /actionReason\.trim\(\)\.length < 8/);
  assert.match(page, /body: JSON\.stringify\(\{ incidentId: selected\.id, command: action, expectedVersion: selected\.version, reason/);
  assert.doesNotMatch(page, /command\("resolve", "Incident investigation completed/);
});
