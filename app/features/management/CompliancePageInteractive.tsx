"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState, PageHeader, Status } from "../../components/ControlPrimitives";
import { formatDateValue as formatDateValueWithZone } from "@/lib/date-format";

type NoticeTone = "success" | "warning" | "error" | "info";
type WorkspaceMode = "operations" | "management";

export default function CompliancePageInteractive({ timeZone, onNotify, onNavigate }: { timeZone: string; onNotify: (message: string, tone?: NoticeTone) => void; onNavigate: (page: string, mode?: WorkspaceMode) => void }) {
  const formatDateValue = (value: string | Date, options: Intl.DateTimeFormatOptions, _unusedTimeZone?: string, fallback = "—") => formatDateValueWithZone(value, options, timeZone, fallback);
  const [tab, setTab] = useState("Audit");
  const [events, setEvents] = useState<Array<{ createdAt: string; actionType: string; actorRole?: string | null; entityId?: string | null; reason?: string | null; correlationId: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/audit/events?limit=50", { cache: "no-store", credentials: "include", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { events?: typeof events; error?: string };
        if (!response.ok) throw new Error(body.error || "AUDIT_RECORDS_UNAVAILABLE");
        if (active) setEvents(body.events || []);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "AUDIT_RECORDS_UNAVAILABLE"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function exportAudit() {
    setExporting(true);
    try {
      const response = await fetch("/api/control/audit/export?limit=5000", { cache: "no-store", credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "AUDIT_EXPORT_UNAVAILABLE");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `securevisit-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onNotify("The facility-scoped audit export was downloaded.", "success");
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "The audit export could not be created.", "warning");
    } finally {
      setExporting(false);
    }
  }

  return <><PageHeader eyebrow="Management · Compliance" title="Compliance" description="Investigate the record of what changed, who accessed sensitive material, and which reports are ready." actions={<Button variant="primary" disabled={!events.length || exporting} onClick={() => void exportAudit()}>{exporting ? "Preparing export…" : "Export scoped audit CSV"}</Button>} /><div className="sv3-compliance-tabs">{["Audit", "Recording Access", "Reports", "Security Events"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "Audit" ? <section className="sv3-audit-layout"><div className="sv3-audit-stream"><div className="sv3-audit-head"><div><span className="sv3-eyebrow">Chronological investigation trail</span><h2>Facility audit</h2></div><span className="sv3-toolbar-meta">{events.length} persisted events</span></div>{loading ? <EmptyState title="Loading audit records" body="Reading the facility-scoped append-only audit stream." /> : error ? <EmptyState title="Audit records unavailable" body={error} /> : events.length ? events.map((event) => <button className="sv3-audit-event" key={event.correlationId} onClick={() => onNotify(`${event.correlationId} is a persisted audit correlation.`)}><time>{formatDateValue(event.createdAt, { dateStyle: "medium", timeStyle: "short" }, undefined, "Date unavailable")}</time><span className="sv3-audit-dot" /><div><strong>{event.actionType}</strong><small>{event.actorRole || "System"} · {event.entityId || "Facility"}</small><p>{event.reason || "Recorded action"}</p><em>Correlation {event.correlationId}</em></div><b>›</b></button>) : <EmptyState title="No audit events recorded" body="No persisted events exist in the current facility scope." />}</div><aside className="sv3-audit-side"><div className="sv3-surface"><span className="sv3-eyebrow">Export controls</span><h2>Auditable by design</h2><p>Exports require facility scope, the audit export permission, and step-up authentication.</p><Button variant="primary" disabled={!events.length || exporting} onClick={() => void exportAudit()}>{exporting ? "Preparing…" : "Download CSV"}</Button></div></aside></section> : <ComplianceTab timeZone={timeZone} tab={tab} onNotify={onNotify} onNavigate={onNavigate} />}</>;
}

type ComplianceSecurityEvent = { id: string; eventType: string; severity: string; requestId: string | null; createdAt: string; metadata?: Record<string, unknown>; linkedIncidentId?: string | null };
type ComplianceRecording = { id: string; session_id: string; status: string; content_type?: string | null; byte_size?: number | null; sha256?: string | null; retention_until?: string | null; legal_hold?: number; access_count?: number; last_accessed_at?: string | null; created_at: string; updated_at: string; appointment_id: string; requested_start: string; requested_end: string; visitor_name: string; prisoner_name: string };
type ComplianceLegalHold = { id: string; entity_type: string; entity_id: string; reason: string; status: string; created_at: string };

function ComplianceTab({ timeZone, tab, onNotify, onNavigate }: { timeZone: string; tab: string; onNotify: (message: string, tone?: NoticeTone) => void; onNavigate: (page: string, mode?: WorkspaceMode) => void }) {
  const formatDateValue = (value: string | Date, options: Intl.DateTimeFormatOptions, _unusedTimeZone?: string, fallback = "—") => formatDateValueWithZone(value, options, timeZone, fallback);
  const [securityEvents, setSecurityEvents] = useState<ComplianceSecurityEvent[]>([]);
  const [recordings, setRecordings] = useState<ComplianceRecording[]>([]);
  const [legalHolds, setLegalHolds] = useState<ComplianceLegalHold[]>([]);
  const [auditCount, setAuditCount] = useState<number | null>(null);
  const [financeSummary, setFinanceSummary] = useState<{ credits_purchased?: number; credits_consumed?: number; credits_reserved?: number; refund_cases?: number } | null>(null);
  const [reportCounts, setReportCounts] = useState<{ appointmentCount: number; openIncidentCount: number } | null>(null);
  const [reportError, setReportError] = useState(false);
  const [securityError, setSecurityError] = useState(false);
  const [recordingsError, setRecordingsError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const loadingTimer = window.setTimeout(() => setLoading(true), 0);
    const requests: Promise<void>[] = [];
    const securityResetTimer = tab === "Security Events" ? window.setTimeout(() => { if (active) { setSecurityEvents([]); setSecurityError(false); } }, 0) : null;
    if (tab === "Security Events") requests.push(fetch("/api/control/security-events", { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error("SECURITY_EVENTS_UNAVAILABLE"); const body = await response.json() as { events?: ComplianceSecurityEvent[] }; if (active) setSecurityEvents(body.events || []); }).catch(() => { if (active) setSecurityError(true); }));
    const recordingResetTimer = tab === "Recording Access" ? window.setTimeout(() => { if (active) { setRecordings([]); setRecordingsError(false); } }, 0) : null;
    if (tab === "Recording Access") requests.push(Promise.all([fetch("/api/control/recordings", { cache: "no-store", credentials: "include", headers: { accept: "application/json" } }), fetch("/api/control/legal-holds", { cache: "no-store", credentials: "include", headers: { accept: "application/json" } })]).then(async ([recordingsResponse, holdsResponse]) => { if (!recordingsResponse.ok || !holdsResponse.ok) throw new Error("RECORDINGS_UNAVAILABLE"); const recordingsBody = await recordingsResponse.json() as { recordings?: ComplianceRecording[] }; const holdsBody = await holdsResponse.json() as { holds?: ComplianceLegalHold[] }; if (active) { setRecordings(recordingsBody.recordings || []); setLegalHolds(holdsBody.holds || []); } }).catch(() => { if (active) setRecordingsError(true); }));
    const reportResetTimer = tab === "Reports" ? window.setTimeout(() => { if (active) { setAuditCount(null); setFinanceSummary(null); setReportCounts(null); setReportError(false); } }, 0) : null;
    if (tab === "Reports") { requests.push(fetch("/api/control/reports", { cache: "no-store", credentials: "include", headers: { accept: "application/json" } }).then(async (response) => { if (!response.ok) throw new Error("REPORT_DATA_UNAVAILABLE"); const body = await response.json() as { audit?: { eventCount?: number }; finance?: typeof financeSummary; appointments?: Array<{ status?: string; count?: number }>; incidents?: Array<{ status?: string; count?: number }> }; if (active) { setAuditCount(body.audit?.eventCount ?? null); setFinanceSummary(body.finance || null); setReportCounts({ appointmentCount: (body.appointments || []).reduce((total, row) => total + Number(row.count || 0), 0), openIncidentCount: (body.incidents || []).filter((row) => !["RESOLVED", "CLOSED"].includes(String(row.status || "").toUpperCase())).reduce((total, row) => total + Number(row.count || 0), 0) }); } }).catch(() => { if (active) setReportError(true); })); }
    Promise.all(requests).finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(loadingTimer); if (reportResetTimer !== null) window.clearTimeout(reportResetTimer); if (securityResetTimer !== null) window.clearTimeout(securityResetTimer); if (recordingResetTimer !== null) window.clearTimeout(recordingResetTimer); };
  }, [tab, refreshNonce]);
  const createReconciliationIncident = async (event: ComplianceSecurityEvent) => {
    const metadata = event.metadata || {};
    const entityType = typeof metadata.entityType === "string" ? metadata.entityType : "";
    const entityId = typeof metadata.entityId === "string" ? metadata.entityId : "";
    const incidentIdempotencyKey = `security-event-incident-${event.id}`;
    try {
      const response = await fetch("/api/control/incidents", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": incidentIdempotencyKey },
        body: JSON.stringify({
          incidentType: "RECONCILIATION",
          severity: "CRITICAL",
          title: `Reconciliation required · ${entityId || event.id}`,
          description: `A ${event.eventType.replaceAll("_", " ").toLowerCase()} requires staff review. Correlation ${String(metadata.correlationId || "not recorded")}; expected version ${String(metadata.expectedVersion || "not recorded")}.`,
          appointmentId: entityType === "appointment" ? entityId : undefined,
          resourceId: entityType === "resource" ? entityId : undefined,
          sourceSecurityEventId: event.id,
        }),
      });
      const body = await response.json() as { incidentId?: string; error?: string };
      if (!response.ok || !body.incidentId) throw new Error(body.error || "Incident could not be created.");
      setSecurityEvents((current) => current.map((item) => item.id === event.id ? { ...item, linkedIncidentId: body.incidentId } : item));
      onNotify(`Incident ${body.incidentId} created for staff follow-up.`, "success");
    } catch (reason: unknown) {
      onNotify(reason instanceof Error ? reason.message : "Incident could not be created.", "error");
    }
  };
  const changeRecordingHold = async (recording: ComplianceRecording) => {
    const activeHold = legalHolds.find((hold) => hold.entity_type === "recording" && hold.entity_id === recording.id && hold.status === "ACTIVE");
    const action = activeHold ? "RELEASE" : "CREATE";
    const reason = window.prompt(activeHold ? "Reason for releasing this recording legal hold:" : "Reason for placing this recording under legal hold:", activeHold ? "Retention review completed by the authorized reviewer." : "Recording required for an active institutional review.") || "";
    if (reason.trim().length < 8) return;
    try {
      const response = await fetch("/api/control/legal-holds", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `recording-legal-hold-${recording.id}-${action}-${activeHold?.id || "new"}` }, body: JSON.stringify(activeHold ? { action, holdId: activeHold.id, reason } : { action, entityType: "recording", entityId: recording.id, reason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "STEP_UP_REQUIRED" || body.error === "STEP_UP_INVALID" ? "A fresh supervisor step-up is required before changing a legal hold." : body.error || "The legal hold could not be changed.");
      onNotify(action === "CREATE" ? "Recording legal hold created and retention protection is active." : "Recording legal hold released and the retention schedule can resume.", "success");
      setRefreshNonce((value) => value + 1);
    } catch (reasonValue: unknown) { onNotify(reasonValue instanceof Error ? reasonValue.message : "The legal hold could not be changed.", "error"); }
  };
  if (tab === "Recording Access") return <div className="sv3-settings-surface"><div className="sv3-rule-line"><div><strong>Governed recording inventory</strong><small>Only facility-scoped recordings persisted by the LiveKit workflow appear here. Playback is audited and never exposes a raw R2 URL.</small></div><Status tone={recordingsError ? "red" : recordings.length ? "blue" : "green"}>{recordingsError ? "UNAVAILABLE" : `${recordings.length} RECORDING${recordings.length === 1 ? "" : "S"}`}</Status></div>{recordingsError ? <EmptyState title="Recording inventory unavailable" body="The protected recording service could not be reached. No empty state is being inferred." /> : loading ? <EmptyState title="Loading recording inventory" body="Reading governed recordings for the current facility scope." /> : recordings.length ? <div className="sv3-security-events">{recordings.map((recording) => { const activeHold = legalHolds.some((hold) => hold.entity_type === "recording" && hold.entity_id === recording.id && hold.status === "ACTIVE"); return <div className="sv3-security-event" key={recording.id}><span>{activeHold ? "▣" : "●"}</span><div><strong>{recording.visitor_name} · {recording.prisoner_name}</strong><small>{formatDateValue(recording.created_at, { dateStyle: "medium", timeStyle: "short" }, undefined, "Date unavailable")} · {recording.status}</small><small>{activeHold ? "Legal hold active" : recording.retention_until ? `Retention until ${formatDateValue(recording.retention_until, { dateStyle: "medium" }, undefined, "Date unavailable")}` : "Retention deadline not available"}</small><small>{recording.access_count || 0} audited access{recording.access_count === 1 ? "" : "es"}{recording.last_accessed_at ? ` · last ${formatDateValue(recording.last_accessed_at, { dateStyle: "medium", timeStyle: "short" }, undefined, "Date unavailable")}` : " · never opened"}</small></div><Status tone={recording.status === "AVAILABLE" ? "green" : recording.status === "FAILED" ? "red" : "orange"}>{recording.status}</Status><Button variant="quiet" onClick={() => void changeRecordingHold(recording)}>{activeHold ? "Release legal hold" : "Place legal hold"}</Button>{recording.status === "AVAILABLE" ? <Button variant="quiet" onClick={() => window.open(`/api/control/recordings/${encodeURIComponent(recording.id)}/playback`, "_blank", "noopener,noreferrer")}>Open audited playback</Button> : null}</div>; })}</div> : <EmptyState title="No recordings available" body="No governed recording has reached AVAILABLE status in the current facility scope." />}</div>;
  if (tab === "Reports") return <div className="sv3-report-grid">{[["Daily operations", reportError ? "Report unavailable" : loading || auditCount === null || !reportCounts ? "Loading" : `${auditCount} audit events · ${reportCounts.appointmentCount} appointments`, "Persisted facility activity", reportError ? "UNAVAILABLE" : loading || auditCount === null || !reportCounts ? "LOADING" : "READY", "Command Center", "operations"], ["Credit reconciliation", reportError ? "Report unavailable" : financeSummary ? `${financeSummary.credits_purchased || 0} purchased · ${financeSummary.credits_consumed || 0} consumed` : "Financial records unavailable", "Persisted D1 ledger summary", reportError ? "UNAVAILABLE" : financeSummary ? "READY" : "UNAVAILABLE", "Finance", "management"], ["Incident posture", reportError ? "Report unavailable" : reportCounts ? `${reportCounts.openIncidentCount} open incident${reportCounts.openIncidentCount === 1 ? "" : "s"}` : "Loading", "Persisted facility incidents", reportError ? "UNAVAILABLE" : loading || !reportCounts ? "LOADING" : reportCounts.openIncidentCount ? "REVIEW" : "READY", "Incidents", "operations"]].map((report) => <button type="button" className="sv3-report-card" key={report[0]} onClick={() => onNavigate(report[4], report[5] as WorkspaceMode)} aria-label={`Open ${report[0]} workspace`}><span className="sv3-report-icon">▤</span><strong>{report[0]}</strong><small>{report[1]} · {report[2]}</small><Status tone={report[3] === "READY" ? "green" : report[3] === "REVIEW" || report[3] === "UNAVAILABLE" ? "red" : "orange"}>{report[3]}</Status><b>{report[3] === "READY" ? "Open workspace →" : "Review workspace →"}</b></button>)}</div>;
  return <div className="sv3-security-events">{loading ? <div className="sv3-empty"><strong>Loading persisted security events…</strong></div> : securityError ? <div className="sv3-empty" role="alert"><strong>Security events unavailable</strong><p>The protected security-event service could not be reached. No empty state is being inferred.</p></div> : securityEvents.length ? securityEvents.map((event) => { const metadata = event.metadata || {}; const requiresStaffReview = event.severity === "CRITICAL" && metadata.requiresStaffReview === true; const incidentId = event.linkedIncidentId; return <div className={`sv3-security-event ${event.severity === "CRITICAL" ? "critical" : ""}`} key={event.id}><span>{event.severity === "CRITICAL" ? "!" : event.severity === "WARNING" ? "!" : "✓"}</span><div><strong>{event.eventType.replaceAll("_", " ")}</strong><small>{formatDateValue(event.createdAt, { dateStyle: "medium", timeStyle: "short" }, undefined, "Date unavailable")} · {event.requestId || "No request ID"}</small>{requiresStaffReview ? <small>Staff review required · {incidentId ? `Incident ${incidentId}` : "No incident linked"}</small> : null}</div><Status tone={event.severity === "CRITICAL" ? "red" : event.severity === "WARNING" ? "orange" : "green"}>{event.severity}</Status>{requiresStaffReview ? <Button variant="quiet" onClick={() => void createReconciliationIncident(event)} disabled={Boolean(incidentId)}>{incidentId ? "Incident created" : "Create incident"}</Button> : null}</div>; }) : <div className="sv3-empty"><strong>No security events recorded</strong><p>The current facility scope has no persisted security events.</p></div>}<Button variant="secondary" onClick={() => { setRefreshNonce((value) => value + 1); onNotify("Security events refreshed from the current facility scope.", "info"); }}>Refresh facility scope</Button></div>;
}


