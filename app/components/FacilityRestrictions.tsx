"use client";

import { useState } from "react";

type FacilityState = "NORMAL_OPERATIONS" | "LIMITED_OPERATIONS" | "LOCKDOWN" | "EMERGENCY_CLOSURE" | "TECHNICAL_DEGRADATION";

const options: Array<{ value: FacilityState; label: string; detail: string }> = [
  { value: "NORMAL_OPERATIONS", label: "Normal operations", detail: "Requests, admissions, and active visits follow the configured policy." },
  { value: "LIMITED_OPERATIONS", label: "Limited operations", detail: "New work is restricted while staff resolve an operational limitation." },
  { value: "TECHNICAL_DEGRADATION", label: "Technical degradation", detail: "Technical recovery is required before affected visits can proceed." },
  { value: "EMERGENCY_CLOSURE", label: "Emergency closure", detail: "The facility is closed to visitation until staff restore operations." },
  { value: "LOCKDOWN", label: "Lockdown", detail: "All operational transitions require supervisor review." },
];

export default function FacilityRestrictions({ state, onChange }: { state: string; onChange: (nextState: FacilityState, reason: string) => Promise<void> }) {
  const [draft, setDraft] = useState<FacilityState>((options.some((option) => option.value === state) ? state : "NORMAL_OPERATIONS") as FacilityState);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = options.find((option) => option.value === draft) || options[0];

  const save = async () => {
    if (reason.trim().length < 8) return;
    setBusy(true);
    try {
      await onChange(draft, reason.trim());
      setReason("");
    } finally {
      setBusy(false);
    }
  };

  return <div className="sv3-settings-surface">
    <div className="sv3-rule-line"><div><strong>Operational restriction</strong><small>Changes are written to the facility record, version-checked, audited, and applied by visitor, waiting-room, and live-session guards.</small></div><span className={`sv3-policy-version ${state === "NORMAL_OPERATIONS" ? "" : "sv3-restriction-active"}`}>{state.replaceAll("_", " ")}</span></div>
    <div className="sv3-form-grid">
      <label>Facility state<select value={draft} onChange={(event) => setDraft(event.target.value as FacilityState)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <div className="sv3-settings-callout"><strong>{selected.label}</strong><p>{selected.detail}</p></div>
      <label className="sv3-policy-reason">Reason for change<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Explain the operational reason (minimum 8 characters)." /></label>
    </div>
    <p className="sv3-policy-feedback">Current restriction: {state.replaceAll("_", " ")}. A fresh supervisor step-up is required for lockdown and emergency closure.</p>
    <button className="sv3-button sv3-button-primary" onClick={() => void save()} disabled={busy || reason.trim().length < 8 || draft === state}>{busy ? "Applying…" : "Apply facility state"}</button>
  </div>;
}
