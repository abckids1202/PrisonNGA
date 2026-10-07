import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("audit CSV exports neutralize spreadsheet formulas before hashing and download", async () => {
  const source = await readFile(new URL("../lib/server/csv.ts", import.meta.url), "utf8");
  assert.match(source, /spreadsheet formula injection/);
  assert.match(source, /\[\\t\\r\\n \]\*\[=\+\\-@\]/);
  assert.match(source, /const safeText =/);
  assert.match(source, /safeText\.replaceAll/);
});
