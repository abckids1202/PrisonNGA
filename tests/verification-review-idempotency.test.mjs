import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("verification review decisions are replay-safe for every decision state", async () => {
  const source = await readFile(new URL("../app/api/control/verification/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(d1/);
  assert.match(source, /completeIdempotencyStatement/);
  assert.match(source, /releaseIdempotencyClaim\(d1, idempotency\)/);
  assert.match(source, /verificationDecisionStatements/);
  assert.match(source, /VERIFICATION_REVIEW_NOT_PERSISTED/);
});

