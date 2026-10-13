"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateValue } from "@/lib/date-format";

type Policy = {
  id: string;
  facilityId: string;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  dailyStartTime: string;
  dailyEndTime: string;
  weeklyHours: Array<{ open: string | null; close: string | null }> | null;
  creditPriceMinor: number | null;
  creditCurrency: string;
  version: number;
  updatedAt: string;
};

type HistoryEntry = { version: number; actor_user_id: string; reason: string; snapshot: string; created_at: string };

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const fallbackError = "Could not load the facility policy. Check your staff session and try again.";

export default function VisitPolicyEditor({ timeZone = "Asia/Jakarta" }: { timeZone?: string | null }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/control/visit-policy", { headers: { accept: "application/json" }, cache: "no-store" });
      const body = await response.json() as { policy?: Policy; history?: HistoryEntry[]; error?: string };
      if (!response.ok || !body.policy) throw new Error(body.error || fallbackError);
      setPolicy(body.policy);
      setDraft(body.policy);
      setHistory(body.history || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallbackError);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async () => {
    if (!policy || !draft || reason.trim().length < 8) {
      setError("Add a specific change reason of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/control/visit-policy", {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `visit-policy-${policy.id}-${policy.version}` },
        body: JSON.stringify({
          expectedVersion: policy.version,
          reason,
          policy: {
            minDurationMinutes: draft.minDurationMinutes,
            maxDurationMinutes: draft.maxDurationMinutes,
            minAdvanceMinutes: draft.minAdvanceMinutes,
            maxAdvanceDays: draft.maxAdvanceDays,
            dailyStartTime: draft.dailyStartTime,
            dailyEndTime: draft.dailyEndTime,
            creditPriceMinor: draft.creditPriceMinor,
            creditCurrency: draft.creditCurrency,
            weeklyHours: draft.weeklyHours,
          },
        }),
      });
      const body = await response.json() as { policy?: Policy; error?: string };
      if (!response.ok || !body.policy) {
        if (body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID") {
          throw new Error("A fresh supervisor step-up check is required or has expired. Facility policy was not changed.");
        }
        if (body.error === "STALE_POLICY") {
          await load();
          throw new Error("Someone changed this policy while you were editing. The latest version is loaded; review it before trying again.");
        }
        throw new Error(body.error || "The policy could not be saved.");
      }
      setPolicy(body.policy);
      setDraft(body.policy);
      setReason("");
      setMessage("Policy saved. New visitor availability requests now use this version.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The policy could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Policy>(key: K, value: Policy[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const setWeekly = (index: number, field: "open" | "close", value: string | null) => setDraft((current) => {
    if (!current) return current;
    const entries = current.weeklyHours || days.map(() => ({ open: current.dailyStartTime, close: current.dailyEndTime }));
    return { ...current, weeklyHours: entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry) };
  });

  if (error && !policy) return <div className="sv3-settings-surface"><p role="alert">{error}</p><button onClick={() => void load()} disabled={busy}>Retry</button></div>;
  if (!draft) return <div className="sv3-settings-surface" aria-live="polite">Loading facility policy…</div>;

  return <div className="sv3-settings-surface">
    <div className="sv3-rule-line"><div><strong>Visitor booking rules</strong><small>These values are read by the visitor availability and appointment APIs. Current version: {policy?.version ?? "—"}</small></div><span className="sv3-policy-version">v{policy?.version ?? "—"}</span></div>
    <div className="sv3-form-grid">
      <label>Minimum visit duration (minutes)<input type="number" min="15" max="120" step="15" value={draft.minDurationMinutes} onChange={(event) => set("minDurationMinutes", Number(event.target.value))} /></label>
      <label>Maximum visit duration (minutes)<input type="number" min="15" max="120" step="15" value={draft.maxDurationMinutes} onChange={(event) => set("maxDurationMinutes", Number(event.target.value))} /></label>
      <label>Minimum booking notice (minutes)<input type="number" min="0" max="10080" value={draft.minAdvanceMinutes} onChange={(event) => set("minAdvanceMinutes", Number(event.target.value))} /></label>
      <label>Booking horizon (days)<input type="number" min="1" max="365" value={draft.maxAdvanceDays} onChange={(event) => set("maxAdvanceDays", Number(event.target.value))} /></label>
      <label>Daily opening time<input type="time" value={draft.dailyStartTime} onChange={(event) => set("dailyStartTime", event.target.value)} /></label>
      <label>Daily closing time<input type="time" value={draft.dailyEndTime} onChange={(event) => set("dailyEndTime", event.target.value)} /></label>
      <label>Visit Credit price (IDR)<input type="number" min="1" max="1000000000" step="1" value={draft.creditPriceMinor ?? ""} onChange={(event) => set("creditPriceMinor", event.target.value === "" ? null : Number(event.target.value))} /></label>
      <label>Credit currency<input value={draft.creditCurrency} readOnly /></label>
      <fieldset className="sv3-weekly-hours"><legend>Weekly operating hours</legend><small>Closed days are excluded from visitor availability and staff approval.</small>{(draft.weeklyHours || days.map(() => ({ open: draft.dailyStartTime, close: draft.dailyEndTime }))).map((hours, index) => <div className="sv3-weekly-hours-row" key={days[index]}><strong>{days[index]}</strong><label>Open<input type="time" value={hours.open || ""} onChange={(event) => setWeekly(index, "open", event.target.value || null)} /></label><label>Close<input type="time" value={hours.close || ""} onChange={(event) => setWeekly(index, "close", event.target.value || null)} /></label><button type="button" className="sv3-button" onClick={() => { setWeekly(index, "open", null); setWeekly(index, "close", null); }}>{hours.open === null && hours.close === null ? "Closed" : "Mark closed"}</button></div>)}</fieldset>
      <label className="sv3-policy-reason">Reason for change<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Explain why the facility rule needs to change (minimum 8 characters)." /></label>
    </div>
    {error ? <p role="alert" className="sv3-policy-feedback error">{error}</p> : null}
    {message ? <p role="status" className="sv3-policy-feedback success">{message}</p> : null}
    <button className="sv3-button sv3-button-primary" onClick={() => void save()} disabled={busy || !policy || reason.trim().length < 8}>Save policy · requires supervisor step-up</button>
    {history.length ? <section className="sv3-policy-history"><h3>Recent changes</h3>{history.map((entry) => <article key={`${entry.version}-${entry.created_at}`}><span>Version {entry.version}</span><time dateTime={entry.created_at}>{formatDateValue(entry.created_at, { dateStyle: "medium", timeStyle: "short" }, timeZone, "Date unavailable")}</time><p>{entry.reason}</p></article>)}</section> : null}
  </div>;
}
