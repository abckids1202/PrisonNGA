"use client";

import { useEffect, useState } from "react";
import { Button, Status } from "./ControlPrimitives";

type Facility = { id: string; name: string; timezone: string; current_state: string; version: number };
type Organization = { id: string; name: string; slug: string; status: string; version: number };

function keyFor(facilityId: string) { return `facility-${facilityId}-${crypto.randomUUID()}`; }

export default function OrganizationFacilitiesPanel({ onNotify }: { onNotify?: (message: string, tone?: "success" | "warning" | "error" | "info") => void }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [createForm, setCreateForm] = useState({ name: "", timezone: "Asia/Jakarta", reason: "New facility approved for institutional pilot operations." });
  const [drafts, setDrafts] = useState<Record<string, { name: string; timezone: string; reason: string }>>({});

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/control/facilities", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
      const body = await response.json() as { organization?: Organization; facilities?: Facility[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Organization facilities are unavailable.");
      const nextFacilities = body.facilities || [];
      setOrganization(body.organization || null);
      setFacilities(nextFacilities);
      setDrafts((current) => Object.fromEntries(nextFacilities.map((facility) => [facility.id, current[facility.id] || { name: facility.name, timezone: facility.timezone, reason: "Facility identity updated after institutional review." }])));
      setError("");
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Organization facilities are unavailable."); }
    finally { setLoading(false); }
  };

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);

  const createFacility = async (event: React.FormEvent) => {
    event.preventDefault();
    if (createForm.name.trim().length < 2 || createForm.reason.trim().length < 8) return;
    setBusy("create");
    try {
      const response = await fetch("/api/control/facilities", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": keyFor("create") }, body: JSON.stringify(createForm) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before creating a facility." : body.error || "Facility creation failed.");
      setCreateForm({ name: "", timezone: "Asia/Jakarta", reason: "New facility approved for institutional pilot operations." });
      onNotify?.("Facility created and its default visit policy was recorded.", "success");
      await load();
    } catch (reason: unknown) { const message = reason instanceof Error ? reason.message : "Facility creation failed."; setError(message); onNotify?.(message, "error"); }
    finally { setBusy(""); }
  };

  const updateFacility = async (facility: Facility) => {
    const draft = drafts[facility.id];
    if (!draft || draft.name.trim().length < 2 || draft.timezone.trim().length < 3 || draft.reason.trim().length < 8) return;
    setBusy(facility.id);
    try {
      const response = await fetch(`/api/control/facilities/${encodeURIComponent(facility.id)}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `${keyFor(facility.id)}-${facility.version}` }, body: JSON.stringify({ ...draft, expectedVersion: facility.version }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before editing facility identity." : body.error || "Facility update failed.");
      onNotify?.(`${facility.name} was updated and audited.`, "success");
      await load();
    } catch (reason: unknown) { const message = reason instanceof Error ? reason.message : "Facility update failed."; setError(message); onNotify?.(message, "error"); }
    finally { setBusy(""); }
  };

  return <div className="sv3-admin-content">
    <div className="sv3-admin-stat"><span>Organization</span><strong>{organization?.name || "—"}</strong><small>{organization?.slug || "Organization record unavailable"} · {facilities.length} facility{facilities.length === 1 ? "" : "ies"}</small></div>
    <section className="sv3-settings-surface"><div className="sv3-rule-line"><div><strong>Create facility</strong><small>Creates the facility, default visit policy, and organization membership in one audited transaction. Step-up is required.</small></div><Button onClick={() => void load()} disabled={loading}>Refresh</Button></div><form className="sv3-form-grid" onSubmit={createFacility}><label>Facility name<input required minLength={2} maxLength={160} value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} /></label><label>Timezone<input required value={createForm.timezone} onChange={(event) => setCreateForm({ ...createForm, timezone: event.target.value })} /></label><label className="sv3-form-wide">Reason<textarea required minLength={8} maxLength={500} value={createForm.reason} onChange={(event) => setCreateForm({ ...createForm, reason: event.target.value })} /></label><div><Button variant="primary" disabled={loading || !!busy}>{busy === "create" ? "Creating…" : "Create facility"}</Button></div></form></section>
    {error ? <section className="sv3-settings-surface" role="alert"><Status tone="red">ACTION NEEDED</Status><strong>Organization configuration unavailable</strong><p>{error}</p><Button onClick={() => void load()}>Try again</Button></section> : null}
    <section className="sv3-settings-surface"><div className="sv3-rule-line"><div><strong>Facilities</strong><small>Facility identity is editable; operational restrictions and visit policies remain in the facility workspace.</small></div><span className="sv3-toolbar-meta">{facilities.length} records</span></div>{loading ? <div className="sv3-empty"><strong>Loading facilities</strong><p>Reading organization-scoped facility records.</p></div> : facilities.length ? <div className="sv3-form-stack">{facilities.map((facility) => { const draft = drafts[facility.id] || { name: facility.name, timezone: facility.timezone, reason: "Facility identity updated after institutional review." }; return <div className="sv3-notification-failure" key={facility.id}><div><strong>{facility.name}</strong><small>{facility.id} · version {facility.version}</small></div><div className="sv3-form-grid"><label>Name<input value={draft.name} onChange={(event) => setDrafts({ ...drafts, [facility.id]: { ...draft, name: event.target.value } })} /></label><label>Timezone<input value={draft.timezone} onChange={(event) => setDrafts({ ...drafts, [facility.id]: { ...draft, timezone: event.target.value } })} /></label><label className="sv3-form-wide">Reason<textarea value={draft.reason} onChange={(event) => setDrafts({ ...drafts, [facility.id]: { ...draft, reason: event.target.value } })} /></label><Button variant="primary" disabled={loading || !!busy} onClick={() => void updateFacility(facility)}>{busy === facility.id ? "Saving…" : "Save facility identity"}</Button></div><Status tone={facility.current_state === "NORMAL_OPERATIONS" ? "green" : "orange"}>{facility.current_state.replaceAll("_", " ")}</Status></div>; })}</div> : <div className="sv3-empty"><strong>No facilities configured</strong><p>Create the first facility after institutional approval.</p></div>}</section>
  </div>;
}
