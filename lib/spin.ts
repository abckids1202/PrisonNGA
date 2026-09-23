export const SPIN_DURATION_MS = 4800;
export const SPIN_EASING = "cubic-bezier(0.05, 0.78, 0.12, 1)";

export type SpinSegment = { id: string; label: string };
export type PersistedSpinResult = {
  resultId: string;
  selectedSegmentId: string;
  selectedIndex: number;
  finalAngle: number;
  fullTurns: number;
  randomOffsetDegrees: number;
  seed: string;
};

export function createSpinResult(input: { resultId: string; segments: SpinSegment[]; selectedIndex: number; randomOffsetDegrees: number; fullTurns?: number; seed: string }): PersistedSpinResult {
  if (!input.segments.length) throw new Error("SPIN_SEGMENTS_REQUIRED");
  if (!Number.isInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex >= input.segments.length) throw new Error("SPIN_SEGMENT_INVALID");
  if (!Number.isFinite(input.randomOffsetDegrees) || input.randomOffsetDegrees < 0 || input.randomOffsetDegrees >= 1) throw new Error("SPIN_OFFSET_INVALID");
  const fullTurns = input.fullTurns ?? 6;
  if (!Number.isInteger(fullTurns) || fullTurns < 3) throw new Error("SPIN_TURNS_INVALID");
  const segmentAngle = 360 / input.segments.length;
  const finalAngle = fullTurns * 360 + (input.selectedIndex * segmentAngle) + (input.randomOffsetDegrees * segmentAngle);
  return { resultId: input.resultId, selectedSegmentId: input.segments[input.selectedIndex].id, selectedIndex: input.selectedIndex, finalAngle, fullTurns, randomOffsetDegrees: input.randomOffsetDegrees, seed: input.seed };
}

export function spinTransform(result: PersistedSpinResult, reducedMotion = false): string {
  return `rotate(${reducedMotion ? result.finalAngle % 360 : result.finalAngle}deg)`;
}

