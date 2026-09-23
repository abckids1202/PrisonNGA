"use client";

import { useEffect, useRef, useState } from "react";
import { SPIN_DURATION_MS, SPIN_EASING, spinTransform, type PersistedSpinResult } from "@/lib/spin";

type DeterministicSpinProps = { result: PersistedSpinResult; disabled?: boolean; onComplete?: () => void; onHaptic?: () => void; onAudio?: () => void };

export default function DeterministicSpin({ result, disabled = false, onComplete, onHaptic, onAudio }: DeterministicSpinProps) {
  const [spinning, setSpinning] = useState(false);
  const [started, setStarted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const completedResult = useRef<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  function start() {
    if (disabled || spinning || completedResult.current === result.resultId) return;
    setStarted(true);
    setSpinning(true);
    onHaptic?.();
    onAudio?.();
    const duration = reducedMotion ? 0 : SPIN_DURATION_MS;
    window.setTimeout(() => {
      completedResult.current = result.resultId;
      setSpinning(false);
      onComplete?.();
    }, duration);
  }

  return <button type="button" className={`sv-spin-trigger ${spinning ? "is-spinning" : ""}`} disabled={disabled || spinning} onClick={start} aria-busy={spinning}>
    <span className="sv-spin-wheel" style={{ transform: started ? spinTransform(result, reducedMotion) : "rotate(0deg)", transition: spinning ? `transform ${SPIN_DURATION_MS}ms ${SPIN_EASING}` : "none" }} aria-hidden="true" />
    <span>{spinning ? "Working…" : "Start"}</span>
  </button>;
}
