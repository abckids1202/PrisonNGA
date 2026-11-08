"use client";

import { useEffect, useState } from "react";
import { Button, Status } from "./ControlPrimitives";

type Membership = { id: string; user_id: string; facility_id: string; role: string; status: string; version: number; email: string | null; display_name: string; facility_name: string | null };
type Option = { id: string; name: string; email?: string | null; display_name?: string; status?: string };

export default function OrganizationMembershipsPanel({ onNotify }: { onNotify?: (message: string, tone?: "success" | "warning" | "error" | "info") => void }) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [facilities, setFacilities] = useState<Option[]>([]);
  const [staff, setStaff] = useState<Option[]>([]);
  const [roles, setRoles] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ userId: "", facilityId: "", roleId: "", employeeReference: "", jobTitle: "", department: "", reason: "Facility access approved by the institutional administrator." });

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/control/memberships", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
      const body = await response.json() as { memberships?: Membership[]; facilities?: Option[]; staff?: Option[]; roles?: Option[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Facility access records are unavailable.");
      setMemberships(body.memberships || []); setFacilities(body.facilities || []); setStaff(body.staff || []); setRoles(body.roles || []);
      setForm((current) => ({ ...current, userId: current.userId || body.staff?.[0]?.id || "", facilityId: current.facilityId || body.facilities?.[0]?.id || "", roleId: current.roleId || body.roles?.[0]?.id || "" }));
      setError("");
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Facility access records are unavailable."); }
    finally { setLoading(false); }
  };

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);

  const assign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.userId || !form.facilityId || !form.roleId || form.employeeReference.trim().length < 1 || form.jobTitle.trim().length < 1 || form.reason.trim().length < 8) return;
    setBusy("assign");
    try {
      const response = await fetch("/api/control/memberships", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `facility-membership-${crypto.randomUUID()}` }, body: JSON.stringify(form) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before assigning facility access." : body.error || "Facility access assignment failed.");
      onNotify?.("Facility access assigned and recorded in the audit trail.", "success");
      await load();
    } catch (reason: unknown) { const message = reason instanceof Error ? reason.message : "Facility access assignment failed."; setError(message); onNotify?.(message, "error"); }
    finally { setBusy(""); }
  };

  const revoke = async (membership: Membership) => {
    const reason = window.prompt("Reason for revoking facility access:", "Facility access removed after institutional review.") || "";
    if (reason.trim().length < 8) return;
    setBusy(membership.id);
    try {
      const response = await fetch("/api/control/memberships", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `facility-membership-revoke-${membership.id}-${membership.version}` }, body: JSON.stringify({ membershipId: membership.id, expectedVersion: membership.version, reason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before revoking facility access." : body.error || "Facility access revocation failed.");
      onNotify?.("Facility access revoked and sessions were handled by the backend policy.", "success"); await load();
    } catch (reason: unknown) { const message = reason instanceof Error ? reason.message : "Facility access revocation failed."; setError(message); onNotify?.(message, "error"); }
    finally { setBusy(""); }
  };

  return <div className="sv3-admin-content"><div className="sv3-admin-stat"><span>Facility access</span><strong>{loading ? "—" : memberships.filter((membership) => membership.status === "ACTIVE" && membership.facility_id).length}</strong><small>Active organization memberships with a facility scope</small></div><section className="sv3-settings-surface"><div className="sv3-rule-line"><div><strong>Assign facility access</strong><small>Assign an existing organization staff member to a facility. The server enforces scope, step-up, idempotency, and audit history.</small></div><Button onClick={() => void load()} disabled={loading}>Refresh</Button></div><form className="sv3-form-grid" onSubmit={assign}><label>Staff member<select required value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}><option value="">Select staff</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.display_name} · {member.email}</option>)}</select></label><label>Facility<select required value={form.facilityId} onChange={(event) => setForm({ ...form, facilityId: event.target.value })}><option value="">Select facility</option>{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>Facility role<select required value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}><option value="">Select role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label>Employee reference<input required value={form.employeeReference} onChange={(event) => setForm({ ...form, employeeReference: event.target.value })} /></label><label>Job title<input required value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} /></label><label>Department<input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label><label className="sv3-form-wide">Reason<textarea required minLength={8} maxLength={500} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label><div><Button variant="primary" disabled={loading || !!busy || !form.userId || !form.facilityId || !form.roleId}>{busy === "assign" ? "Assigning…" : "Assign facility access"}</Button></div></form></section>{error ? <section className="sv3-settings-surface" role="alert"><Status tone="red">ACTION NEEDED</Status><strong>Facility access unavailable</strong><p>{error}</p><Button onClick={() => void load()}>Try again</Button></section> : null}<section className="sv3-settings-surface"><div className="sv3-rule-line"><div><strong>Access register</strong><small>Revocation is version-safe and leaves the membership history intact.</small></div><span className="sv3-toolbar-meta">{memberships.length} records</span></div>{loading ? <div className="sv3-empty"><strong>Loading facility access</strong></div> : memberships.length ? <div className="sv3-staff-list">{memberships.filter((membership) => membership.facility_id).map((membership) => <div className="sv3-notification-failure" key={membership.id}><span><strong>{membership.display_name}</strong><small>{membership.email || "Email unavailable"}</small></span><span><strong>{membership.facility_name || membership.facility_id}</strong><small>{membership.role} · v{membership.version}</small></span><Status tone={membership.status === "ACTIVE" ? "green" : "red"}>{membership.status}</Status>{membership.status === "ACTIVE" ? <button className="sv3-button" disabled={!!busy} onClick={() => void revoke(membership)}>{busy === membership.id ? "Revoking…" : "Revoke"}</button> : null}</div>)}</div> : <div className="sv3-empty"><strong>No facility memberships</strong><p>Assign facility access after the organization and facility have been approved.</p></div>}</section></div>;
}
