"use client";

import { useEffect, useState, type FormEvent } from "react";

type Prisoner = {
  id: string;
  prisoner_number: string;
  display_name: string;
  housing_unit: string | null;
  status: "ACTIVE" | "TRANSFERRED" | "RELEASED" | "INACTIVE";
  visitation_status: "APPROVED" | "RESTRICTED" | "SUSPENDED";
  version: number;
  approved_visitor_count: number;
  active_visit_count: number;
  next_visit_at: string | null;
};

type Draft = Omit<Prisoner, "id" | "version" | "approved_visitor_count" | "active_visit_count" | "next_visit_at">;
const blank: Draft = { prisoner_number: "", display_name: "", housing_unit: "", status: "ACTIVE", visitation_status: "SUSPENDED" };

export default function PrisonerDirectory({ onNotify }: { onNotify: (message: string, tone?: "success" | "info" | "warning" | "error") => void }) {
  const [records, setRecords] = useState<Prisoner[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<Prisoner | null>(null);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/control/prisoners", { credentials: "include", headers: { accept: "application/json" }, cache: "no-store" });
      const body = await response.json() as { prisoners?: Prisoner[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load facility prisoner records.");
      setRecords(body.prisoners || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load facility prisoner records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function edit(record: Prisoner) {
    setEditing(record);
    setDraft({ prisoner_number: record.prisoner_number, display_name: record.display_name, housing_unit: record.housing_unit || "", status: record.status, visitation_status: record.visitation_status });
    setReason("");
  }

  function clearForm() {
    setEditing(null);
    setDraft(blank);
    setReason("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 8) { setError("Please enter a reason of at least 8 characters."); return; }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/control/prisoners", {
        method: editing ? "PATCH" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `prisoner-${editing ? "update" : "create"}-${editing?.id || draft.prisoner_number}-${editing?.version || 1}-${crypto.randomUUID()}` },
        body: JSON.stringify({
          prisonerNumber: draft.prisoner_number,
          displayName: draft.display_name,
          housingUnit: draft.housing_unit,
          status: draft.status,
          visitationStatus: draft.visitation_status,
          reason: reason.trim(),
          ...(editing ? { id: editing.id, expectedVersion: editing.version } : {}),
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        if (body.error === "STALE_PRISONER_RECORD") throw new Error("This record changed while you were editing. The latest records have been reloaded.");
        if (body.error === "PRISONER_NUMBER_ALREADY_EXISTS") throw new Error("That prisoner number is already in use at this facility.");
        throw new Error(body.error || "Could not save the prisoner record.");
      }
      onNotify(editing ? "Prisoner record updated and audited." : "Prisoner record created. Visitation is suspended until staff approves it.", "success");
      clearForm();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the prisoner record.");
      if (cause instanceof Error && cause.message.includes("changed while")) await load();
    } finally {
      setSaving(false);
    }
  }

  const visible = records.filter((record) => `${record.prisoner_number} ${record.display_name} ${record.housing_unit || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="sv6-prisoner-workspace">
    <div className="sv6-prisoner-toolbar"><div><strong>{records.length}</strong><span>facility records</span><small>Only approved active prisoners appear in visitor search.</small></div><label className="sv3-search"><span>⌕</span><input aria-label="Search prisoners" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, ID, or housing unit" /></label></div>
    <div className="sv6-prisoner-layout">
      <section className="sv6-prisoner-list" aria-label="Prisoner directory">
        {loading ? <p className="sv6-prisoner-empty">Loading facility records…</p> : error && !records.length ? <div className="sv6-prisoner-empty" role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div> : visible.length ? visible.map((record) => <article className={`sv6-prisoner-row ${editing?.id === record.id ? "selected" : ""}`} key={record.id}>
          <div className="sv6-prisoner-avatar">{record.display_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
          <div className="sv6-prisoner-main"><strong>{record.display_name}</strong><small>{record.prisoner_number} · {record.housing_unit || "Housing unit not recorded"}</small><span>{record.approved_visitor_count} approved connection{record.approved_visitor_count === 1 ? "" : "s"} · {record.active_visit_count} active visit record{record.active_visit_count === 1 ? "" : "s"}</span></div>
          <div className="sv6-prisoner-status"><span className={record.status === "ACTIVE" ? "good" : "muted"}>{record.status.replaceAll("_", " ")}</span><span className={record.visitation_status === "APPROVED" ? "good" : "caution"}>VISITS {record.visitation_status}</span></div>
          <button type="button" className="sv6-prisoner-edit" onClick={() => edit(record)}>Edit record</button>
        </article>) : <div className="sv6-prisoner-empty"><strong>{search ? "No matching prisoners" : "No prisoner records yet"}</strong><p>{search ? "Try another name, number, or housing unit." : "Add a facility record. It will remain hidden from visitors until visitation is explicitly approved."}</p></div>}
      </section>
      <form className="sv6-prisoner-form" onSubmit={save}>
        <div><span className="sv3-eyebrow">{editing ? `Record · v${editing.version}` : "Controlled record creation"}</span><h3>{editing ? "Update prisoner" : "Add prisoner"}</h3><p>Changes are facility-scoped and recorded in the audit trail.</p></div>
        <label>Prisoner number<input required maxLength={40} value={draft.prisoner_number} onChange={(event) => setDraft({ ...draft, prisoner_number: event.target.value.toUpperCase() })} placeholder="e.g. CCF-2041" /></label>
        <label>Display name<input required minLength={2} maxLength={160} value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} /></label>
        <label>Housing unit<input maxLength={80} value={draft.housing_unit || ""} onChange={(event) => setDraft({ ...draft, housing_unit: event.target.value })} /></label>
        <label>Record status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Draft["status"], visitation_status: event.target.value === "ACTIVE" ? draft.visitation_status : "SUSPENDED" })}><option value="ACTIVE">Active</option><option value="TRANSFERRED">Transferred</option><option value="RELEASED">Released</option><option value="INACTIVE">Inactive</option></select></label>
        <label>Visitation eligibility<select value={draft.visitation_status} onChange={(event) => setDraft({ ...draft, visitation_status: event.target.value as Draft["visitation_status"] })}><option value="SUSPENDED">Suspended · hidden from visitors</option><option value="RESTRICTED">Restricted · hidden from visitors</option><option value="APPROVED" disabled={draft.status !== "ACTIVE"}>Approved · available for requests</option></select></label>
        <label>Reason for {editing ? "change" : "creation"}<textarea required minLength={8} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain this record change for the audit trail." /></label>
        {error && records.length ? <p className="sv6-prisoner-error" role="alert">{error}</p> : null}
        {editing && editing.active_visit_count > 0 && draft.visitation_status !== "APPROVED" ? <p className="sv6-prisoner-warning" role="status">This prisoner has active or upcoming visit records. New starts and participant-token requests will be blocked; staff must separately resolve scheduled appointments and end any already-running session.</p> : null}
        <div className="sv6-prisoner-actions"><button type="submit" className="sv3-button sv3-button-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save record" : "Create record"}</button>{editing ? <button type="button" className="sv3-button" onClick={clearForm}>Cancel edit</button> : null}</div>
      </form>
    </div>
  </div>;
}
