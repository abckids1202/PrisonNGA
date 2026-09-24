import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("visitor availability reuses the authoritative visit-window validator", async () => {
  const source = await readFile(new URL("../app/api/visitor/availability/route.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ validateVisitWindow \} from .*visit-policy/);
  assert.match(source, /const window = validateVisitWindow\(/);
  assert.match(source, /if \(!window\.ok\) continue/);
});
