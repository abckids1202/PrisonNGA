"use client";

import { useEffect, useState } from "react";

type AppointmentType = { id: string; code: string; display_name: string; description: string; duration_minutes: number; credit_cost: number; status: string; version: number; updated_at: string };

export default function AppointmentTypesPanel() {
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [reason, setReason] = useState("");
  const [createReason, setCreateReason] = useState("");
  const [createDraft, setCreateDraft] = useState({ code: "", displayName: "", description: "", durationMinutes: 30, creditCost: 1 });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/control/appointment-types", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
      const body = await response.json() as { appointmentTypes?: AppointmentType[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Appointment types are unavailable.");
      setTypes(body.appointmentTypes || []); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Appointment types are unavailable."); }
    finally { setLoading(false); }
  };

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);
  const update = (id: string, change: Partial<AppointmentType>) => setTypes((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));

  const save = async (type: AppointmentType) => {
    if (reason.trim().length < 8) { setError("Add a specific change reason of at least 8 characters."); return; }
    const currentType = types.find((item) => item.id === type.id) || type;
    setError("");
    try {
      const response = await fetch("/api/control/appointment-types", { method: "PUT", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `appointment-type-${currentType.id}-${currentType.version}` }, body: JSON.stringify({ id: currentType.id, expectedVersion: currentType.version, displayName: currentType.display_name, description: currentType.description, durationMinutes: currentType.duration_minutes, creditCost: currentType.credit_cost, status: currentType.status, reason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before changing appointment types." : body.error || "Appointment type could not be saved.");
      setEditing(""); setReason(""); await load();
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Appointment type could not be saved."; await load(); setError(message); }
  };

  const create = async () => {
    if (createReason.trim().length < 8) { setError("Add a specific creation reason of at least 8 characters."); return; }
    setCreating(true); setError("");
    try {
      const code = createDraft.code.trim().toUpperCase();
      const response = await fetch("/api/control/appointment-types", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `appointment-type-create-${code}` }, body: JSON.stringify({ ...createDraft, code, reason: createReason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before creating appointment types." : body.error || "Appointment type could not be created.");
      setCreateDraft({ code: "", displayName: "", description: "", durationMinutes: 30, creditCost: 1 }); setCreateReason(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Appointment type could not be created."); }
    finally { setCreating(false); }
  };

  return <div className="sv3-settings-surface">
    <div className="sv3-rule-line"><div><strong>Facility appointment types</strong><small>These catalog entries are read by visitor appointment requests. Changes require appointment-type permission, supervisor step-up, version checks, and history.</small></div><button className="sv3-button" onClick={() => void load()} disabled={loading}>Refresh</button></div>
    {error ? <div className="sv3-empty" role="alert"><strong>Appointment types unavailable</strong><p>{error}</p><button className="sv3-button" onClick={() => void load()}>Try again</button></div> : null}
    <div className="sv3-form-grid"><label>New type code<input value={createDraft.code} onChange={(event) => setCreateDraft({ ...createDraft, code: event.target.value.toUpperCase() })} placeholder="LEGAL_VISIT" /></label><label>Display name<input value={createDraft.displayName} onChange={(event) => setCreateDraft({ ...createDraft, displayName: event.target.value })} placeholder="Legal visit" /></label><label className="sv3-form-wide">Description<textarea value={createDraft.description} onChange={(event) => setCreateDraft({ ...createDraft, description: event.target.value })} placeholder="Describe who this visit type is for." /></label><label>Duration (minutes)<input type="number" min="15" max="120" step="15" value={createDraft.durationMinutes} onChange={(event) => setCreateDraft({ ...createDraft, durationMinutes: Number(event.target.value) })} /></label><label>Credit cost<input type="number" min="1" max="10" value={createDraft.creditCost} onChange={(event) => setCreateDraft({ ...createDraft, creditCost: Number(event.target.value) })} /></label><label className="sv3-policy-reason">Reason<textarea value={createReason} maxLength={500} onChange={(event) => setCreateReason(event.target.value)} placeholder="Explain this catalog addition (minimum 8 characters)." /></label><button className="sv3-button sv3-button-primary" onClick={() => void create()} disabled={creating}>{creating ? "Creating…" : "Create appointment type · requires supervisor step-up"}</button></div>
    {loading ? <div className="sv3-empty"><strong>Loading appointment types</strong><p>Reading the facility-scoped catalog.</p></div> : !types.length ? <div className="sv3-empty"><strong>No appointment types configured</strong><p>Visitor requests cannot be created until the facility publishes an active type.</p></div> : <div className="sv3-policy-history">{types.map((type) => <article key={type.id}><div><span className="sv3-policy-version">{type.status}</span><strong>{type.display_name}</strong><span className="sv3-mono-value">{type.code}</span><button className="sv3-button" onClick={() => setEditing(editing === type.id ? "" : type.id)}>{editing === type.id ? "Close" : "Edit"}</button></div><p>{type.description} · {type.duration_minutes} minutes · {type.credit_cost} credit{type.credit_cost === 1 ? "" : "s"} · v{type.version}</p>{editing === type.id ? <div className="sv3-form-grid"><label>Display name<input value={type.display_name} onChange={(event) => update(type.id, { display_name: event.target.value })} /></label><label>Description<textarea value={type.description} onChange={(event) => update(type.id, { description: event.target.value })} /></label><label>Duration (minutes)<input type="number" min="15" max="120" step="15" value={type.duration_minutes} onChange={(event) => update(type.id, { duration_minutes: Number(event.target.value) })} /></label><label>Credit cost<input type="number" min="1" max="10" value={type.credit_cost} onChange={(event) => update(type.id, { credit_cost: Number(event.target.value) })} /></label><label>Status<select value={type.status} onChange={(event) => update(type.id, { status: event.target.value })}><option>ACTIVE</option><option>INACTIVE</option></select></label><label className="sv3-policy-reason">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain this catalog change (minimum 8 characters)." /></label><button className="sv3-button sv3-button-primary" onClick={() => void save(type)}>Save appointment type · requires supervisor step-up</button></div> : null}</article>)}</div>}
  </div>;
}
