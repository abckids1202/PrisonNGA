import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/visitor/visits/[visitId]/device-check/page.tsx", import.meta.url), "utf8");

test("device preparation reads the visitor-owned visit resource", () => {
  assert.match(source, /api\/visitor\/visits\/\$\{encodeURIComponent\(visitId\)\}/);
  assert.match(source, /body\.visit/);
  assert.doesNotMatch(source, /fetch\(`\/api\/visitor\/appointments\/\$\{encodeURIComponent\(visitId\)\}`/);
});
