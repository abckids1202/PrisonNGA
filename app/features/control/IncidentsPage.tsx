"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState, PageHeader, SectionLabel, Status } from "../../components/ControlPrimitives";
import { formatDateValue as formatDateValueWithZone } from "@/lib/date-format";

type Notice = { id: number; message: string; tone?: "success" | "warning" | "error" | "info" };
type IncidentApiRow = { id: string; incident_type: string; severity: string; status: string; title: string; description: string; appointment_id?: string | null; resource_id?: string | null; reporter_name?: string; assignee_name?: string | null; assigned_user_id?: string | null; resolution?: string | null; version: number; created_at: string };

export default function IncidentsPage({ timeZone, onNotify }: { timeZone: string; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const formatDateValue = (value: string | Date, options: Intl.DateTimeFormatOptions, _unusedTimeZone?: string, fallback = "—") => formatDateValueWithZone(value, options, timeZone, fallback);
  const [incidents, setIncidents] = useState<IncidentApiRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", description: "", incidentType: "OPERATIONAL", severity: "MEDIUM" });
  const [actionReason, setActionReason] = useState("");
  async function refresh() {
    const response = await fetch("/api/control/incidents", { headers: { accept: "application/json" }, credentials: "include" });
    if (!response.ok) throw new Error("Incident records could not be loaded from the protected API.");
    const body = await response.json() as { incidents?: IncidentApiRow[] };
    setIncidents(body.incidents || []);
    setSelectedId((current) => current && (body.incidents || []).some((incident) => incident.id === current) ? current : body.incidents?.[0]?.id || null);
    setLoading(false);
  }
  useEffect(() => { const timer = window.setTimeout(() => { refresh().catch(() => setLoading(false)); }, 0); return () => window.clearTimeout(timer); }, []);
  const selected = incidents.find((incident) => incident.id === selectedId) || incidents[0];
  async function command(action: "acknowledge" | "resolve" | "close" | "add_note") {
    if (!selected) return;
    const reason = actionReason.trim();
    if (reason.length < 8) {
      onNotify("Enter at least 8 characters describing this incident action.", "warning");
      return;
    }
    try {
      const response = await fetch("/api/control/incidents", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `incident:${selected.id}:${action}:${selected.version}` }, credentials: "include", body: JSON.stringify({ incidentId: selected.id, command: action, expectedVersion: selected.version, reason, resolution: action === "resolve" ? reason : undefined }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Incident action was rejected.");
      await refresh();
      onNotify(`Incident ${action.replaceAll("_", " ")} recorded.`, "success");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Incident action failed.", "error"); }
  }
  async function createIncident(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    try {
      const response = await fetch("/api/control/incidents", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `incident-create:${crypto.randomUUID()}` },
        credentials: "include",
        body: JSON.stringify(createForm),
      });
      const body = await response.json() as { error?: string; incidentId?: string };
      if (!response.ok) throw new Error(body.error || "Incident could not be created.");
      setCreateForm({ title: "", description: "", incidentType: "OPERATIONAL", severity: "MEDIUM" });
      setShowCreate(false);
      await refresh();
      if (body.incidentId) setSelectedId(body.incidentId);
      onNotify("Incident created and added to the facility register.", "success");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Incident could not be created.", "error"); }
    finally { setCreating(false); }
  }
  return <><PageHeader eyebrow="Operations · Case management" title="Incidents" description="Persisted operational cases, append-only event history, and controlled resolution actions." actions={<><Status tone="red">{incidents.filter((incident) => !["RESOLVED", "CLOSED"].includes(incident.status)).length} OPEN</Status><Button variant="primary" onClick={() => setShowCreate(true)}>+ Report incident</Button></>} />{loading ? <div className="sv3-empty"><span>◌</span><strong>Loading incident register</strong><p>Reading facility-scoped operational cases.</p></div> : !incidents.length ? <EmptyState title="No incidents recorded" body="Operational problems will appear here when staff create a persisted incident case." /> : <div className="sv3-incident-layout"><section className="sv3-incident-list"><div className="sv3-incident-list-head"><span>OPEN INCIDENTS</span><button onClick={() => refresh().catch(() => undefined)}>Refresh</button></div>{incidents.map((incident) => <button className={`sv3-incident-row ${selected?.id === incident.id ? "active" : ""}`} key={incident.id} onClick={() => setSelectedId(incident.id)}><span className={`sv3-severity severity-${incident.severity.toLowerCase()}`}>{incident.severity}</span><strong>{incident.title}</strong><small>{incident.id} · {formatDateValue(incident.created_at, { dateStyle: "medium", timeStyle: "short" }, undefined, "Date unavailable")}</small><span className="sv3-incident-meta">{incident.appointment_id || incident.resource_id || "Facility-wide"} · {incident.status}</span><b>›</b></button>)}</section>{selected ? <article className="sv3-incident-detail"><div className="sv3-incident-detail-head"><div><span className={`sv3-severity severity-${selected.severity.toLowerCase()}`}>{selected.severity}</span><span className="sv3-eyebrow">INCIDENT {selected.id}</span><h2>{selected.title}</h2><p>{selected.description}</p></div><Status tone={selected.status === "OPEN" ? "red" : selected.status === "RESOLVED" || selected.status === "CLOSED" ? "green" : "orange"}>{selected.status}</Status></div><div className="sv3-incident-columns"><div><SectionLabel>Case facts</SectionLabel><dl><div><dt>Type</dt><dd>{selected.incident_type}</dd></div><div><dt>Reporter</dt><dd>{selected.reporter_name || "Staff"}</dd></div><div><dt>Assignee</dt><dd>{selected.assignee_name || "Unassigned"}</dd></div><div><dt>Related visit</dt><dd>{selected.appointment_id || "None"}</dd></div></dl></div><div><SectionLabel>Resolution</SectionLabel><p>{selected.resolution || "No resolution recorded."}</p><label className="sv3-policy-reason">Action note<textarea value={actionReason} minLength={8} maxLength={2000} onChange={(event) => setActionReason(event.target.value)} placeholder="Record what was checked, what changed, and the next action." /></label><div className="sv3-header-actions"><Button onClick={() => command("acknowledge")} disabled={selected.status !== "OPEN" || actionReason.trim().length < 8}>Acknowledge</Button><Button onClick={() => command("add_note")} disabled={actionReason.trim().length < 8}>Add note</Button><Button variant="primary" onClick={() => command("resolve")} disabled={actionReason.trim().length < 8 || ["RESOLVED", "CLOSED"].includes(selected.status)}>Resolve</Button><Button variant="quiet" onClick={() => command("close")} disabled={selected.status !== "RESOLVED" || actionReason.trim().length < 8}>Close</Button></div></div></div></article> : null}</div>}{showCreate ? <div className="sv3-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) setShowCreate(false); }}><form className="sv3-dialog" role="dialog" aria-modal="true" aria-labelledby="incident-create-title" onSubmit={createIncident}><div className="sv3-dialog-head"><div><span className="sv3-eyebrow">OPERATIONS · NEW CASE</span><h2 id="incident-create-title">Report an incident</h2><p>Create a facility-scoped case. The record, audit event, and notification outbox entry are committed together.</p></div><button type="button" aria-label="Close incident form" onClick={() => setShowCreate(false)} disabled={creating}>×</button></div><label className="sv3-dialog-field">Title<input required minLength={4} maxLength={160} value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} placeholder="e.g. Kiosk camera unavailable" /></label><label className="sv3-dialog-field">Incident type<select value={createForm.incidentType} onChange={(event) => setCreateForm({ ...createForm, incidentType: event.target.value })}><option value="OPERATIONAL">Operational</option><option value="TECHNICAL">Technical</option><option value="SAFETY">Safety</option><option value="SECURITY">Security</option><option value="VISITOR">Visitor support</option></select></label><label className="sv3-dialog-field">Severity<select value={createForm.severity} onChange={(event) => setCreateForm({ ...createForm, severity: event.target.value })}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label><label className="sv3-dialog-field">Description<textarea required minLength={8} maxLength={2000} value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} placeholder="Describe what happened, who is affected, and what staff observed." /></label><div className="sv3-dialog-actions"><Button type="button" variant="quiet" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</Button><Button type="submit" variant="primary" disabled={creating}>{creating ? "Creating…" : "Create incident"}</Button></div></form></div> : null}</>;
}

