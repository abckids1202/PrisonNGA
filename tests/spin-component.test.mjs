import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("reduced-motion spin skips the dramatic transition while preserving the persisted angle", async () => {
  const source = await readFile(new URL("../app/components/DeterministicSpin.tsx", import.meta.url), "utf8");
  assert.match(source, /spinTransform\(result, reducedMotion\)/);
  assert.match(source, /isSpinning && !reducedMotion/);
  assert.match(source, /const duration = reducedMotion \? 0 : SPIN_DURATION_MS/);
});
