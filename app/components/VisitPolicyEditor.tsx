"use client";

import { useCallback, useEffect, useState } from "react";

type Policy = {
  id: string;
  facilityId: string;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  dailyStartTime: string;
  dailyEndTime: string;
  version: number;
  updatedAt: string;
};

type HistoryEntry = { version: number; actor_user_id: string; reason: string; snapshot: string; created_at: string };

const fallbackError = "Could not load the facility policy. Check your staff session and try again.";

export default function VisitPolicyEditor() {
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
        headers: { "content-type": "application/json", accept: "application/json" },
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
      <label className="sv3-policy-reason">Reason for change<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Explain why the facility rule needs to change (minimum 8 characters)." /></label>
    </div>
    {error ? <p role="alert" className="sv3-policy-feedback error">{error}</p> : null}
    {message ? <p role="status" className="sv3-policy-feedback success">{message}</p> : null}
    <button className="sv3-button sv3-button-primary" onClick={() => void save()} disabled={busy || !policy || reason.trim().length < 8}>Save policy · requires supervisor step-up</button>
    {history.length ? <section className="sv3-policy-history"><h3>Recent changes</h3>{history.map((entry) => <article key={`${entry.version}-${entry.created_at}`}><span>Version {entry.version}</span><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time><p>{entry.reason}</p></article>)}</section> : null}
  </div>;
}
