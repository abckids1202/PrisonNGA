import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/visitor/verification/evidence/route.ts", import.meta.url), "utf8");

test("evidence upload cleanup never deletes an object after its database row persisted", () => {
  assert.match(source, /let evidencePersisted = false;/);
  assert.match(source, /evidencePersisted = Boolean\(inserted\[0\]\?\.meta\.changes\)/);
  assert.match(source, /if \(!evidencePersisted\) await bucket\.delete\(storageKey\)/);
});
