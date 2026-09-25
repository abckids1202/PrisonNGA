import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Finance reconciliation refreshes authoritative data and exposes open issues", () => {
  assert.match(source, /const runChecks = async \(\) =>/);
  assert.match(source, /const refreshed = await load\(\)/);
  assert.match(source, /Open reconciliation issues/);
  assert.match(source, /data\.reconciliation\.issues\.map/);
});
