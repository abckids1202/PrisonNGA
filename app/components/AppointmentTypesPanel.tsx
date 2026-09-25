"use client";

import { useEffect, useState } from "react";

type AppointmentType = { id: string; code: string; display_name: string; description: string; duration_minutes: number; credit_cost: number; status: string; version: number; updated_at: string };

export default function AppointmentTypesPanel() {
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string>("");
  const [reason, setReason] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/control/appointment-types", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { appointmentTypes?: AppointmentType[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Appointment types are unavailable.");
        setTypes(body.appointmentTypes || []);
        setError("");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Appointment types are unavailable."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);

  const save = async (type: AppointmentType) => {
    if (reason.trim().length < 8) { setError("Add a specific change reason of at least 8 characters."); return; }
    const currentType = types.find((item) => item.id === type.id) || type;
    setError("");
    try {
      const response = await fetch("/api/control/appointment-types", { method: "PUT", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `appointment-type-${currentType.id}-${crypto.randomUUID()}` }, body: JSON.stringify({ id: currentType.id, expectedVersion: currentType.version, displayName: currentType.display_name, description: currentType.description, durationMinutes: currentType.duration_minutes, creditCost: currentType.credit_cost, status: currentType.status, reason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Appointment type could not be saved.");
      setEditing("");
      setReason("");
      load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Appointment type could not be saved."); }
  };

  return <div className="sv3-settings-surface">
    <div className="sv3-rule-line"><div><strong>Facility appointment types</strong><small>These active catalog entries are read by visitor appointment requests. Changes require a dedicated approval and version-history workflow.</small></div><button className="sv3-button" onClick={load} disabled={loading}>Refresh</button></div>
    {error ? <div className="sv3-empty" role="alert"><strong>Appointment types unavailable</strong><p>{error}</p><button className="sv3-button" onClick={load}>Try again</button></div> : loading ? <div className="sv3-empty"><strong>Loading appointment types</strong><p>Reading the facility-scoped catalog.</p></div> : !types.length ? <div className="sv3-empty"><strong>No appointment types configured</strong><p>Visitor requests cannot be created until the facility publishes an active type.</p></div> : <div className="sv3-policy-history">{types.map((type) => <article key={type.id}><div><span className="sv3-policy-version">{type.status}</span><strong>{type.display_name}</strong><span className="sv3-mono-value">{type.code}</span><button className="sv3-button" onClick={() => setEditing(editing === type.id ? "" : type.id)}>{editing === type.id ? "Close" : "Edit"}</button></div><p>{type.description} · {type.duration_minutes} minutes · {type.credit_cost} credit{type.credit_cost === 1 ? "" : "s"} · v{type.version}</p>{editing === type.id ? <div className="sv3-form-grid"><label>Display name<input value={type.display_name} readOnly /></label><label>Status<select value={type.status} onChange={(event) => setTypes((current) => current.map((item) => item.id === type.id ? { ...item, status: event.target.value } : item))}><option>ACTIVE</option><option>INACTIVE</option></select></label><label className="sv3-policy-reason">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain this catalog change (minimum 8 characters)." /></label><button className="sv3-button sv3-button-primary" onClick={() => void save(type)}>Save status · requires supervisor step-up</button></div> : null}</article>)}</div>}
  </div>;
}
