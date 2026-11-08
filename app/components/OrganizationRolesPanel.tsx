"use client";

import { useEffect, useState } from "react";
import { Button, Status } from "./ControlPrimitives";

type Assignment = { user_id: string; organization_id: string; role_id: string; role_name: string; status: string; version: number; email: string | null; display_name: string; assigned_at: string };
type Role = { id: string; name: string; description: string };
type Staff = { id: string; email: string; display_name: string; status: string };

export default function OrganizationRolesPanel({ onNotify }: { onNotify?: (message: string, tone?: "success" | "warning" | "error" | "info") => void }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ userId: "", roleId: "", reason: "Organization access approved by the institutional administrator." });

  const load = async () => {
    setLoading(true);
    try {
      const roleResponse = await fetch("/api/control/organization-roles", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
      const roleBody = await roleResponse.json() as { assignments?: Assignment[]; roles?: Role[]; eligibleStaff?: Staff[]; error?: string };
      if (!roleResponse.ok) throw new Error(roleBody.error || "Organization roles are unavailable.");
      setAssignments(roleBody.assignments || []);
      setRoles(roleBody.roles || []);
      const eligible = (roleBody.eligibleStaff || []).filter((member) => member.status === "ACTIVE");
      setStaff(eligible);
      setForm((current) => ({ ...current, roleId: current.roleId || roleBody.roles?.[0]?.id || "", userId: current.userId || eligible[0]?.id || "" }));
      setError("");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Organization roles are unavailable.");
    } finally { setLoading(false); }
  };

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);

  const assign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.userId || !form.roleId || form.reason.trim().length < 8) return;
    setBusy(`assign:${form.userId}:${form.roleId}`);
    try {
      const response = await fetch("/api/control/organization-roles", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `organization-role-${crypto.randomUUID()}` }, body: JSON.stringify(form) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before changing organization access." : body.error || "Organization role assignment failed.");
      onNotify?.("Organization role assigned and recorded in the audit trail.", "success");
      await load();
    } catch (reason: unknown) { const message = reason instanceof Error ? reason.message : "Organization role assignment failed."; setError(message); onNotify?.(message, "error"); }
    finally { setBusy(""); }
  };

  const revoke = async (assignment: Assignment) => {
    const reason = window.prompt("Reason for revoking this organization role:", "Organization access removed after institutional review.") || "";
    if (reason.trim().length < 8) return;
    setBusy(`revoke:${assignment.user_id}:${assignment.role_id}`);
    try {
      const response = await fetch("/api/control/organization-roles", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `organization-role-revoke-${assignment.user_id}-${assignment.role_id}-${assignment.version}` }, body: JSON.stringify({ userId: assignment.user_id, roleId: assignment.role_id, expectedVersion: assignment.version, reason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before changing organization access." : body.error || "Organization role revocation failed.");
      onNotify?.("Organization role revoked and recorded in the audit trail.", "success");
      await load();
    } catch (reason: unknown) { const message = reason instanceof Error ? reason.message : "Organization role revocation failed."; setError(message); onNotify?.(message, "error"); }
    finally { setBusy(""); }
  };

  return <div className="sv3-admin-content"><div className="sv3-admin-stat"><span>Organization access</span><strong>{loading ? "—" : assignments.filter((assignment) => assignment.status === "ACTIVE").length}</strong><small>Active owner and administrator assignments across the organization</small></div><section className="sv3-settings-surface"><div className="sv3-rule-line"><div><strong>Assign organization access</strong><small>Only Organization Owner and Organization Administrator roles appear here. Mutations require a fresh supervisor step-up.</small></div><button className="sv3-button" onClick={() => void load()} disabled={loading}>Refresh</button></div><form className="sv3-form-grid" onSubmit={assign}><label>Staff member<select required value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}><option value="">Select staff</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.display_name} · {member.email}</option>)}</select></label><label>Organization role<select required value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}><option value="">Select role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label className="sv3-form-wide">Reason<textarea required minLength={8} maxLength={500} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label><div><Button variant="primary" disabled={loading || !!busy || !form.userId || !form.roleId}>{busy.startsWith("assign:") ? "Assigning…" : "Assign organization role"}</Button></div></form></section>{error ? <div className="sv3-settings-surface" role="alert"><Status tone="red">ACTION NEEDED</Status><strong>Organization access unavailable</strong><p>{error}</p><button className="sv3-button" onClick={() => void load()}>Try again</button></div> : null}<section className="sv3-settings-surface"><div className="sv3-rule-line"><div><strong>Organization role assignments</strong><small>Revocation is version-checked and cannot silently overwrite a concurrent change.</small></div><span className="sv3-toolbar-meta">{assignments.length} records</span></div>{loading ? <div className="sv3-empty"><strong>Loading organization access</strong><p>Reading the organization-scoped role register.</p></div> : assignments.length ? <div className="sv3-staff-list">{assignments.map((assignment) => <div className="sv3-notification-failure" key={`${assignment.user_id}:${assignment.role_id}`}><span><strong>{assignment.display_name}</strong><small>{assignment.email || "Email unavailable"}</small></span><span><strong>{assignment.role_name}</strong><small>Assigned {assignment.assigned_at ? new Date(assignment.assigned_at).toLocaleString() : "Date unavailable"} · v{assignment.version}</small></span><Status tone={assignment.status === "ACTIVE" ? "green" : "red"}>{assignment.status}</Status>{assignment.status === "ACTIVE" ? <button className="sv3-button" disabled={!!busy} onClick={() => void revoke(assignment)}>{busy === `revoke:${assignment.user_id}:${assignment.role_id}` ? "Revoking…" : "Revoke"}</button> : null}</div>)}</div> : <div className="sv3-empty"><strong>No organization roles assigned</strong><p>Assign an owner or administrator after the institutional approval step.</p></div>}</section></div>;
}
