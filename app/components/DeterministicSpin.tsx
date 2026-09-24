"use client";

import { useEffect, useRef, useState } from "react";
import { SPIN_DURATION_MS, SPIN_EASING, spinTransform, type PersistedSpinResult } from "@/lib/spin";

type DeterministicSpinProps = { result: PersistedSpinResult; disabled?: boolean; onComplete?: () => void; onHaptic?: () => void; onAudio?: () => void };

export default function DeterministicSpin({ result, disabled = false, onComplete, onHaptic, onAudio }: DeterministicSpinProps) {
  const [spinning, setSpinning] = useState(false);
  const [started, setStarted] = useState(false);
  const [startedResultId, setStartedResultId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const completedResult = useRef<string | null>(null);
  const completionTimer = useRef<number | null>(null);

  useEffect(() => {
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
    completionTimer.current = null;
    completedResult.current = null;
    return () => {
      if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
      completionTimer.current = null;
    };
  }, [result.resultId]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  function start() {
    const isSpinning = spinning && startedResultId === result.resultId;
    if (disabled || isSpinning || completedResult.current === result.resultId) return;
    setStarted(true);
    setStartedResultId(result.resultId);
    setSpinning(true);
    onHaptic?.();
    onAudio?.();
    const duration = reducedMotion ? 0 : SPIN_DURATION_MS;
    completionTimer.current = window.setTimeout(() => {
      completionTimer.current = null;
      completedResult.current = result.resultId;
      setSpinning(false);
      onComplete?.();
    }, duration);
  }

  const isSpinning = spinning && startedResultId === result.resultId;
  const hasStarted = started && startedResultId === result.resultId;
  return <button type="button" className={`sv-spin-trigger ${isSpinning ? "is-spinning" : ""}`} disabled={disabled || isSpinning} onClick={start} aria-busy={isSpinning}>
    <span className="sv-spin-wheel" style={{ transform: hasStarted ? spinTransform(result, reducedMotion) : "rotate(0deg)", transition: isSpinning ? `transform ${SPIN_DURATION_MS}ms ${SPIN_EASING}` : "none" }} aria-hidden="true" />
    <span>{isSpinning ? "Working…" : "Start"}</span>
  </button>;
}
