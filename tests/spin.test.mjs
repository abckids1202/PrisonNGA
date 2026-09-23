import assert from "node:assert/strict";
import test from "node:test";
import { createSpinResult, SPIN_DURATION_MS, SPIN_EASING, spinTransform } from "../lib/spin.ts";

const segments = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }, { id: "d", label: "D" }];

test("spin result is deterministic and auditable before animation", () => {
  const result = createSpinResult({ resultId: "spin-1", segments, selectedIndex: 2, randomOffsetDegrees: 0.25, seed: "audit-seed", fullTurns: 6 });
  assert.equal(result.selectedSegmentId, "c");
  assert.equal(result.finalAngle, 2362.5);
  assert.equal(spinTransform(result), "rotate(2362.5deg)");
  assert.equal(spinTransform(result, true), "rotate(202.5deg)");
});

test("spin contract keeps the dramatic timing and easing explicit", () => {
  assert.ok(SPIN_DURATION_MS >= 4200 && SPIN_DURATION_MS <= 5500);
  assert.equal(SPIN_EASING, "cubic-bezier(0.05, 0.78, 0.12, 1)");
  assert.throws(() => createSpinResult({ resultId: "bad", segments, selectedIndex: 4, randomOffsetDegrees: 0.1, seed: "x" }), /SPIN_SEGMENT_INVALID/);
});
