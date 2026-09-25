"use client";

import { useCallback, useEffect, useState } from "react";

type Closure = { id: string; startsAt: string; endsAt: string; reason: string; status: "ACTIVE" | "CANCELLED"; version: number; createdAt: string };

function errorMessage(code: string | undefined): string {
  if (code === "STEP_UP_REQUIRED" || code === "STEP_UP_INVALID") return "A supervisor step-up check is required before changing facility closures.";
  if (code === "CLOSURE_OVERLAPS_EXISTING") return "This closure overlaps an existing active closure.";
  if (code === "STALE_CLOSURE") return "This closure changed in another session. Refresh the list and try again.";
  return code || "The closure operation could not be completed.";
}

export default function FacilityClosures() {
  const [closures, setClosures] = useState<Closure[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/control/facility-closures", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
      const body = await response.json() as { closures?: Closure[]; error?: string };
      if (!response.ok) throw new Error(errorMessage(body.error));
      setClosures(body.closures || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Facility closures are unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const create = async () => {
    if (!startsAt || !endsAt || reason.trim().length < 8) {
      setError("Choose a start and end time and provide a reason of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/control/facility-closures", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `facility-closure-${crypto.randomUUID()}` },
        body: JSON.stringify({ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), reason }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(errorMessage(body.error));
      setStartsAt("");
      setEndsAt("");
      setReason("");
      setMessage("Closure saved. Affected visitor slots are no longer bookable.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The closure could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (closure: Closure) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/control/facility-closures", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ closureId: closure.id, expectedVersion: closure.version, reason: "Staff reopened this facility window." }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(errorMessage(body.error));
      setMessage("Closure cancelled. The affected window can be evaluated for new availability.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The closure could not be cancelled.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="sv3-settings-surface">
    <div className="sv3-rule-line"><div><strong>Facility closures and blackout windows</strong><small>Active windows remove affected slots from visitor availability and are enforced again on direct appointment requests.</small></div><button className="sv3-button" onClick={() => void load()} disabled={loading || busy}>Refresh</button></div>
    <div className="sv3-form-grid">
      <label>Starts<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
      <label>Ends<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
      <label className="sv3-policy-reason">Reason<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Maintenance, institutional closure, or another approved reason." /></label>
    </div>
    {error ? <p role="alert" className="sv3-policy-feedback error">{error}</p> : null}
    {message ? <p role="status" className="sv3-policy-feedback success">{message}</p> : null}
    <button className="sv3-button sv3-button-primary" onClick={() => void create()} disabled={busy || reason.trim().length < 8}>Create closure · requires supervisor step-up</button>
    <section className="sv3-policy-history"><h3>Closure history</h3>{loading ? <p>Loading persisted closure windows…</p> : !closures.length ? <p>No closure windows are recorded for this facility.</p> : closures.map((closure) => <article key={closure.id}><div><span className="sv3-policy-version">{closure.status}</span><time dateTime={closure.startsAt}>{new Date(closure.startsAt).toLocaleString("en-ID")}</time><span> → {new Date(closure.endsAt).toLocaleString("en-ID")}</span></div><p>{closure.reason}</p>{closure.status === "ACTIVE" ? <button className="sv3-button" disabled={busy} onClick={() => void cancel(closure)}>Cancel closure</button> : null}</article>)}</section>
  </div>;
}
