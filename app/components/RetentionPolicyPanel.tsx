"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState, Status } from "./ControlPrimitives";
import { formatDateValue } from "@/lib/date-format";

type RetentionPolicy = { id: string; evidence_type: string; retention_days: number; version: number; effective_at: string; created_by?: string | null };

export default function RetentionPolicyPanel({ timeZone, onNotify }: { timeZone: string; onNotify: (message: string, tone?: "success" | "warning" | "error" | "info") => void }) {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("Retention schedule reviewed by the authorized facility supervisor.");
  const [newEvidenceType, setNewEvidenceType] = useState("VISITOR_VERIFICATION");
  const [newRetentionDays, setNewRetentionDays] = useState(365);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/control/retention", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
      const body = await response.json() as { policies?: RetentionPolicy[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Retention policies are unavailable.");
      const next = body.policies || [];
      setPolicies(next);
      setDrafts(Object.fromEntries(next.map((policy) => [policy.evidence_type, policy.retention_days])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Retention policies are unavailable."); }
    finally { setLoading(false); }
  };

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);

  const save = async (policy: RetentionPolicy) => {
    const retentionDays = drafts[policy.evidence_type];
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650 || reason.trim().length < 8) { setError("Use 1–3650 days and provide a specific change reason of at least 8 characters."); return; }
    setBusy(policy.evidence_type); setError("");
    try {
      const response = await fetch("/api/control/retention", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `retention-policy-${policy.evidence_type}-${policy.version}-${crypto.randomUUID()}` }, body: JSON.stringify({ evidenceType: policy.evidence_type, retentionDays, expectedVersion: policy.version, reason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before changing retention." : body.error || "Retention policy could not be saved.");
      onNotify(`${policy.evidence_type} retention policy saved and audited.`, "success");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Retention policy could not be saved."); }
    finally { setBusy(""); }
  };

  const create = async () => {
    if (!/^[A-Z0-9_.:-]{2,80}$/.test(newEvidenceType) || !Number.isInteger(newRetentionDays) || newRetentionDays < 1 || newRetentionDays > 3650 || reason.trim().length < 8) { setError("Use an uppercase evidence type, 1–3650 days, and a specific reason of at least 8 characters."); return; }
    setBusy("new"); setError("");
    try {
      const response = await fetch("/api/control/retention", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `retention-policy-create-${newEvidenceType}-${crypto.randomUUID()}` }, body: JSON.stringify({ evidenceType: newEvidenceType, retentionDays: newRetentionDays, reason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before creating retention." : body.error || "Retention policy could not be created.");
      onNotify(`${newEvidenceType} retention policy created and audited.`, "success");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Retention policy could not be created."); }
    finally { setBusy(""); }
  };

  return <div className="sv3-settings-surface"><div className="sv3-rule-line"><div><strong>Evidence retention schedules</strong><small>Facility policy controls how long uploaded evidence remains available. Legal holds override deletion until released.</small></div><Status tone={error ? "red" : "blue"}>{error ? "ACTION NEEDED" : `${policies.length} POLICY${policies.length === 1 ? "" : "IES"}`}</Status></div>{error ? <p className="sv3-policy-feedback error" role="alert">{error}</p> : null}{loading ? <EmptyState title="Loading retention policies" body="Reading facility-scoped schedules from D1." /> : !policies.length ? <><div className="sv3-empty"><strong>No retention policies configured</strong><p>Configure the first facility evidence schedule before accepting institutional uploads.</p></div><div className="sv3-form-grid"><label>Evidence type<input value={newEvidenceType} onChange={(event) => setNewEvidenceType(event.target.value.toUpperCase())} placeholder="VISITOR_VERIFICATION" /></label><label>Retention days<input type="number" min="1" max="3650" value={newRetentionDays} onChange={(event) => setNewRetentionDays(Number(event.target.value))} /></label><label className="sv3-policy-reason">Reason<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label><Button variant="primary" onClick={() => void create()} disabled={busy === "new"}>{busy === "new" ? "Creating…" : "Create schedule · step-up required"}</Button></div></> : <div className="sv3-policy-history">{policies.map((policy) => <article key={policy.id}><div><strong>{policy.evidence_type}</strong><span className="sv3-mono-value">v{policy.version}</span><small>Effective {formatDateValue(policy.effective_at, { dateStyle: "medium", timeStyle: "short" }, timeZone, "Date unavailable")}</small></div><div className="sv3-form-grid"><label>Retention days<input type="number" min="1" max="3650" value={drafts[policy.evidence_type] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [policy.evidence_type]: Number(event.target.value) }))} /></label><label className="sv3-policy-reason">Reason<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label><Button variant="primary" onClick={() => void save(policy)} disabled={busy === policy.evidence_type}>{busy === policy.evidence_type ? "Saving…" : "Save schedule · step-up required"}</Button></div></article>)}</div>}</div>;
}
