import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("legal-hold create and release routes require replay-safe idempotency", async () => {
  const source = await readFile(new URL("../app/api/control/legal-holds/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(d1/);
  assert.match(source, /completeIdempotencyStatement/);
  assert.match(source, /releaseIdempotencyClaim\(d1, idempotency\)/);
  assert.match(source, /createLegalHoldStatements/);
  assert.match(source, /releaseLegalHoldStatements/);
});

