"use client";

import { useCallback, useEffect, useState } from "react";
import PrisonerDirectory from "../../components/PrisonerDirectory";
import { Avatar, Button, EmptyState, PageHeader, Status } from "../../components/ControlPrimitives";
import { facilityTimeZoneLabel } from "../control/model";
import { formatDateValue as formatDateValueWithZone } from "@/lib/date-format";

type Notice = { id: number; message: string; tone?: "success" | "warning" | "error" | "info" };
type PeopleRecord = {
  id: string;
  name: string;
  status: string;
  connection: string;
  relationship: string;
  nextDate: string;
  nextTime: string;
  activity: string;
  initials: string;
  tone: string;
  meta: string;
};

type VerificationQueueCase = {
  id: string; relationship_id: string; status: string; evidence_required: number; submitted_at: string; version: number;
  visitor_user_id: string; prisoner_id: string; relationship_type: string; visitor_name: string; prisoner_number: string; prisoner_name: string; evidence_count: number;
};
type VerificationEvidence = { id: string; original_filename: string; content_type: string; byte_size: number; status: string; created_at: string };

function VerificationQueue({ timeZone, onNotify }: { timeZone: string; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const formatDateValue = (value: string | Date, options: Intl.DateTimeFormatOptions, _unusedTimeZone?: string, fallback = "—") => formatDateValueWithZone(value, options, timeZone, fallback);
  const [cases, setCases] = useState<VerificationQueueCase[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [evidence, setEvidence] = useState<VerificationEvidence[]>([]);
  const [evidenceForCaseId, setEvidenceForCaseId] = useState("");
  const [evidenceRefresh, setEvidenceRefresh] = useState(0);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [evidenceError, setEvidenceError] = useState<{ caseId: string; message: string } | null>(null);
  const selected = cases.find((item) => item.id === selectedId);
  const activeCases = cases.filter((item) => !["APPROVED", "REJECTED"].includes(item.status));
  const evidenceLoading = Boolean(selectedId && evidenceForCaseId !== selectedId && evidenceError?.caseId !== selectedId);
  const selectedEvidenceError = evidenceError?.caseId === selectedId ? evidenceError.message : "";

  const loadCases = useCallback(async () => {
    try {
      const response = await fetch("/api/control/verification", { credentials: "include", headers: { accept: "application/json" } });
      const body = await response.json() as { cases?: VerificationQueueCase[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load the verification queue.");
      const nextCases = body.cases || [];
      setCases(nextCases);
      setSelectedId((current) => nextCases.some((item) => item.id === current && !["APPROVED", "REJECTED"].includes(item.status)) ? current : nextCases.find((item) => !["APPROVED", "REJECTED"].includes(item.status))?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the verification queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/control/verification", { credentials: "include", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { cases?: VerificationQueueCase[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load the verification queue.");
        return body.cases || [];
      })
      .then((nextCases) => {
        if (!active) return;
        setCases(nextCases);
        setSelectedId((current) => nextCases.some((item) => item.id === current && !["APPROVED", "REJECTED"].includes(item.status)) ? current : nextCases.find((item) => !["APPROVED", "REJECTED"].includes(item.status))?.id || "");
      })
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : "Could not load the verification queue."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    fetch(`/api/control/verification/evidence?verificationCaseId=${encodeURIComponent(selectedId)}`, { credentials: "include", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { evidence?: VerificationEvidence[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load submitted documents.");
        if (active) { setEvidence(body.evidence || []); setEvidenceForCaseId(selectedId); }
      })
      .catch((cause: unknown) => active && setEvidenceError({ caseId: selectedId, message: cause instanceof Error ? cause.message : "Could not load submitted documents." }));
    return () => { active = false; };
  }, [selectedId, evidenceRefresh]);

  async function decide(status: "APPROVED" | "REJECTED" | "MORE_INFO") {
    if (!selected) return;
    if (reason.trim().length < 8) { setError("Add a reason of at least 8 characters before recording a decision."); return; }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/control/verification", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `verification-${selected.id}-${selected.version}-${status}` },
        body: JSON.stringify({ verificationCaseId: selected.id, status, reason: reason.trim(), expectedVersion: selected.version }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        if (body.error === "VERIFICATION_EVIDENCE_REQUIRED") throw new Error("Approval is unavailable until an available supporting document is uploaded.");
        if (body.error === "STALE_VERIFICATION_CASE") throw new Error("This case changed while you were reviewing it. Refresh the queue before deciding.");
        throw new Error(body.error || "Could not save the verification decision.");
      }
      onNotify(status === "APPROVED" ? "Connection approved. The visitor can now request a visit." : status === "REJECTED" ? "Connection request declined." : "More information requested from the visitor.", status === "APPROVED" ? "success" : "info");
      setReason("");
      setLoading(true);
      setEvidenceForCaseId("");
      setEvidenceRefresh((value) => value + 1);
      await loadCases();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the verification decision.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="sv3-verification-workspace">
    <div className="sv3-verification-summary"><div><span>Open cases</span><strong>{loading ? "—" : activeCases.length}</strong><small>Facility-scoped review queue</small></div><div><span>Awaiting documents</span><strong>{loading ? "—" : activeCases.filter((item) => item.evidence_required && Number(item.evidence_count) === 0).length}</strong><small>Cannot be approved yet</small></div><div><span>Ready for review</span><strong>{loading ? "—" : activeCases.filter((item) => !item.evidence_required || Number(item.evidence_count) > 0).length}</strong><small>Decision requires a reason</small></div></div>
    <div className="sv3-verification-grid">
      <section className="sv3-verification-list"><div className="sv3-verification-list-head"><div><span className="sv3-eyebrow">Facility review</span><h2>Connection cases</h2></div><button type="button" onClick={() => { setLoading(true); setError(""); setEvidenceForCaseId(""); setEvidenceRefresh((value) => value + 1); void loadCases(); }} disabled={loading}>Refresh ↻</button></div>
        {error && !selected && <div className="sv3-verification-message error" role="alert">{error}{["AUTHENTICATION_REQUIRED", "PERMISSION_DENIED"].includes(error) ? " · Sign in with an account that has verification review access." : ""}</div>}
        {loading ? <div className="sv3-verification-empty">Loading persisted verification cases…</div> : activeCases.length ? activeCases.map((item) => <button type="button" className={`sv3-verification-row ${selectedId === item.id ? "active" : ""}`} key={item.id} onClick={() => { setSelectedId(item.id); setReason(""); setError(""); }}><span className="sv3-verification-avatar">{item.visitor_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="sv3-verification-row-copy"><strong>{item.visitor_name}</strong><small>{item.relationship_type} · {item.prisoner_name} ({item.prisoner_number})</small><small>{formatDateValue(item.submitted_at, { dateStyle: "medium", timeStyle: "short" }, undefined, "Date unavailable")}</small></span><Status tone={item.status === "MORE_INFO" ? "orange" : "purple"}>{item.status.replaceAll("_", " ")}</Status><span className="sv3-verification-count">{item.evidence_count} file{Number(item.evidence_count) === 1 ? "" : "s"}</span></button>) : <div className="sv3-verification-empty">{error ? "The queue could not be loaded." : "No open connection cases. New visitor requests will appear here."}</div>}
      </section>
      <section className="sv3-verification-detail">{selected ? <>
        <div className="sv3-verification-detail-head"><div><span className="sv3-eyebrow">Verification case</span><h2>{selected.visitor_name}</h2><p>Request {selected.id}</p></div><Status tone={selected.status === "MORE_INFO" ? "orange" : selected.status === "PENDING" || selected.status === "IN_REVIEW" ? "purple" : "green"}>{selected.status.replaceAll("_", " ")}</Status></div>
        <div className="sv3-verification-facts"><div><span>Requested connection</span><strong>{selected.relationship_type}</strong></div><div><span>Person in custody</span><strong>{selected.prisoner_name} · {selected.prisoner_number}</strong></div><div><span>Submitted</span><strong>{formatDateValue(selected.submitted_at, { dateStyle: "medium", timeStyle: "short" }, undefined, "Date unavailable")}</strong></div><div><span>Evidence rule</span><strong>{selected.evidence_required ? "Supporting document required" : "Manual review allowed"}</strong></div></div>
        <div className="sv3-verification-documents"><div><span className="sv3-eyebrow">Submitted evidence</span><small>Each protected file access is recorded in the facility audit trail.</small></div>
          {evidenceLoading ? <p>Loading document list…</p> : selectedEvidenceError ? <p className="sv3-verification-message error">{selectedEvidenceError}</p> : evidenceForCaseId === selected.id && evidence.filter((file) => file.status === "AVAILABLE").length ? evidence.filter((file) => file.status === "AVAILABLE").map((file) => <a key={file.id} href={`/api/control/verification/evidence/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer"><span>▤</span><span><strong>{file.original_filename}</strong><small>{file.content_type} · {(file.byte_size / 1024).toFixed(0)} KB · {formatDateValue(file.created_at, { dateStyle: "medium" }, undefined, "Date unavailable")}</small></span><b>Open protected file ↗</b></a>) : evidenceForCaseId === selected.id ? <p>{selected.evidence_required ? "No available evidence yet. The visitor must upload a supporting document before approval." : "No document submitted; the case may be reviewed manually."}</p> : null}
        </div>
        <label className="sv3-verification-reason">Decision reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} placeholder="Record what was verified or what is still needed…" /></label>
        {error && <div className="sv3-verification-message error" role="alert">{error}</div>}
        <div className="sv3-verification-actions"><Button variant="quiet" onClick={() => void decide("MORE_INFO")} disabled={saving}>{saving ? "Saving…" : "Request information"}</Button><Button variant="danger" onClick={() => void decide("REJECTED")} disabled={saving}>{saving ? "Saving…" : "Decline"}</Button><Button variant="primary" onClick={() => void decide("APPROVED")} disabled={saving || (Boolean(selected.evidence_required) && evidence.filter((file) => file.status === "AVAILABLE").length === 0)}>{saving ? "Saving…" : "Approve connection"}</Button></div>
      </> : <div className="sv3-verification-empty">Select a case to review the request and its supporting documents.</div>}</section>
    </div>
  </div>;
}

export default function PeoplePage({ timeZone, onNotify }: { timeZone: string; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Visitors");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [visitFilter, setVisitFilter] = useState("All visits");
  const [visitorRows, setVisitorRows] = useState<PeopleRecord[]>([]);
  const [relationshipRows, setRelationshipRows] = useState<PeopleRecord[]>([]);
  const [counts, setCounts] = useState({ visitors: 0, prisoners: 0, awaitingVerification: 0, relationshipRequests: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const reviewTabs = ["Visitors", "Prisoners", "Verifications", "Relationships"];

  useEffect(() => {
    let active = true;
    fetch("/api/control/people", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as {
          visitors?: Array<Record<string, unknown>>;
          relationships?: Array<Record<string, unknown>>;
          counts?: { visitors?: number; prisoners?: number; awaitingVerification?: number; relationshipRequests?: number };
          truncated?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Unable to load the facility people directory.");
        const rows = (payload.visitors || []).map((row): PeopleRecord => {
          const displayName = String(row.display_name || "Visitor");
          const relationshipStatus = String(row.relationship_status || "");
          const verificationStatus = String(row.verification_status || "");
          const accountStatus = String(row.account_status || "");
          const profileStatus = String(row.profile_status || "");
          const status = accountStatus === "SUSPENDED" || profileStatus === "SUSPENDED"
            ? "SUSPENDED"
            : relationshipStatus === "PENDING"
              ? "PENDING"
              : relationshipStatus === "APPROVED" && verificationStatus === "APPROVED"
                ? "VERIFIED"
                : "NEEDS INFO";
          const visitAt = typeof row.next_visit_at === "string" ? new Date(row.next_visit_at) : null;
          let nextDate = "No upcoming visit";
          let nextTime = "—";
          if (visitAt && !Number.isNaN(visitAt.getTime())) {
            const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(visitAt);
            const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const tomorrowKey = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
            nextDate = dateKey === todayKey ? "Today" : dateKey === tomorrowKey ? "Tomorrow" : new Intl.DateTimeFormat("en-ID", { timeZone, day: "numeric", month: "short" }).format(visitAt);
            const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(visitAt);
            nextTime = `${time} ${facilityTimeZoneLabel(timeZone)}${row.next_room ? ` · ${String(row.next_room)}` : ""}`;
          }
          const relationshipType = typeof row.relationship_type === "string" ? row.relationship_type.replaceAll("_", " ").toLowerCase() : "No connection";
          const connection = typeof row.prisoner_name === "string" ? row.prisoner_name : "No linked prisoner";
          const relationship = relationshipStatus ? `${relationshipType} · ${relationshipStatus.toLowerCase()}` : "No relationship submitted";
          const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
          return {
            id: String(row.visitor_user_id || row.visitor_reference || displayName),
            name: displayName,
            status,
            connection,
            relationship,
            nextDate,
            nextTime,
            activity: visitAt ? "Upcoming visit" : relationshipStatus === "PENDING" ? "Request pending" : "No upcoming visit",
            initials,
            tone: "blue",
            meta: `Visitor · ${String(row.visitor_reference || "ID unavailable")}`,
          };
        });
        const pendingRows = (payload.relationships || []).map((row): PeopleRecord => {
          const displayName = String(row.visitor_name || "Visitor");
          const relationshipType = String(row.relationship_type || "Relationship").replaceAll("_", " ").toLowerCase();
          return {
            id: String(row.relationship_id || row.visitor_user_id || displayName),
            name: displayName,
            status: "PENDING",
            connection: String(row.prisoner_name || "Prisoner record unavailable"),
            relationship: `${relationshipType} · pending review`,
            nextDate: "No upcoming visit",
            nextTime: "—",
            activity: "Relationship review required",
            initials: displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
            tone: "blue",
            meta: `Request · ${String(row.visitor_reference || "Visitor ID unavailable")}`,
          };
        });
        if (!active) return;
        setVisitorRows(rows);
        setRelationshipRows(pendingRows);
        setCounts({
          visitors: Number(payload.counts?.visitors ?? rows.length),
          prisoners: Number(payload.counts?.prisoners || 0),
          awaitingVerification: Number(payload.counts?.awaitingVerification || 0),
          relationshipRequests: Number(payload.counts?.relationshipRequests || 0),
        });
        setTruncated(Boolean(payload.truncated));
        setSelectedId((current) => current || rows[0]?.id || "");
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load the facility people directory.");
        setLoading(false);
      });
    return () => { active = false; };
  }, [timeZone]);

  if (tab === "Verifications") return <div className="sv6-people-page"><PageHeader eyebrow="Management · People" title="People" description="Review visitor identity and relationship evidence using facility-scoped records." /><div className="sv3-entity-tabs sv6-entity-tabs">{reviewTabs.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => { setTab(item); setSearch(""); setStatusFilter("All statuses"); setVisitFilter("All visits"); }}>{item}</button>)}</div><VerificationQueue timeZone={timeZone} onNotify={onNotify} /></div>;
  if (tab === "Prisoners") return <div className="sv6-people-page"><PageHeader eyebrow="Management · People" title="Prisoners" description="Manage facility-scoped prisoner records and explicit visitation eligibility." /><div className="sv3-entity-tabs sv6-entity-tabs">{reviewTabs.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => { setTab(item); setSearch(""); setStatusFilter("All statuses"); setVisitFilter("All visits"); }}>{item}</button>)}</div><PrisonerDirectory onNotify={onNotify} /></div>;

  const rows = tab === "Relationships" ? relationshipRows : visitorRows;
  const filtered = rows
    .filter((row) => `${row.name} ${row.meta} ${row.connection} ${row.relationship}`.toLowerCase().includes(search.toLowerCase()))
    .filter((row) => statusFilter === "All statuses" || row.status === statusFilter)
    .filter((row) => visitFilter === "All visits" || (visitFilter === "Upcoming" ? row.nextDate !== "No upcoming visit" : row.nextDate === "No upcoming visit"));
  const selected = rows.find((row) => row.id === selectedId) || rows[0];
  const tabs: [string, number][] = [["Visitors", counts.visitors], ["Prisoners", counts.prisoners], ["Verifications", counts.awaitingVerification], ["Relationships", counts.relationshipRequests]];
  const statusTone = (status: string) => ["VERIFIED", "ACTIVE"].includes(status) ? "green" : ["RESTRICTED", "SUSPENDED"].includes(status) ? "red" : status === "UNDER REVIEW" ? "purple" : "orange";

  return <div className="sv6-people-page">
    <PageHeader eyebrow="Management · People" title="People" description="Facility-scoped visitor records and current visitation context." />
    <div className="sv6-people-summary"><span><b>{counts.visitors}</b> Visitors</span><i /><span><b>{counts.prisoners}</b> Prisoners</span><i /><span className="needs-review"><b>{counts.awaitingVerification}</b> Awaiting verification</span><i /><span className="needs-review"><b>{counts.relationshipRequests}</b> Relationship requests</span></div>
    <div className="sv3-entity-tabs sv6-entity-tabs">{tabs.map(([item, count]) => <button className={tab === item ? "active" : ""} key={item} onClick={() => { setTab(item); setSearch(""); setStatusFilter("All statuses"); setVisitFilter("All visits"); }}>{item} <em>{count}</em></button>)}</div>
    <div className="sv3-people-layout sv6-people-layout">
      <section className="sv3-people-directory sv6-people-directory">
        <div className="sv3-directory-head sv6-directory-head"><div><span className="sv3-eyebrow">{tab}</span><h2>{tab === "Visitors" ? "Visitor directory" : "Relationship requests"}</h2><p>{tab === "Visitors" ? `${rows.length} facility-linked profiles` : `${rows.length} pending relationship records`}</p></div><div className="sv6-directory-controls"><label className="sv3-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, visitor ID, or connection" /></label><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{Array.from(new Set(rows.map((row) => row.status))).map((status) => <option key={status}>{status}</option>)}</select><select aria-label="Filter by visit" value={visitFilter} onChange={(event) => setVisitFilter(event.target.value)}><option>All visits</option><option>Upcoming</option><option>No upcoming visit</option></select></div></div>
        {search || statusFilter !== "All statuses" || visitFilter !== "All visits" ? <div className="sv6-active-filters"><span>Filters active</span><button onClick={() => { setSearch(""); setStatusFilter("All statuses"); setVisitFilter("All visits"); }}>Clear all ×</button></div> : null}
        <div className="sv3-people-table-head sv6-people-table-head"><span>Person</span><span>Status</span><span>Connection</span><span>Next visit</span><span>Activity</span><span /></div>
        {loading ? <div className="sv6-people-empty"><strong>Loading facility records</strong><p>Retrieving the current authorized directory.</p></div> : loadError ? <div className="sv6-people-empty"><strong>Directory unavailable</strong><p>{loadError}</p><Button onClick={() => window.location.reload()}>Try again</Button></div> : filtered.length ? filtered.map((row) => <button className={`sv3-person-row sv6-person-row ${selected?.id === row.id ? "selected" : ""}`} aria-pressed={selected?.id === row.id} key={row.id} onClick={() => setSelectedId(row.id)}><span className="sv3-table-person"><Avatar initials={row.initials} tone={row.tone} /><span><strong>{row.name}</strong><small>{row.meta}</small></span></span><Status tone={statusTone(row.status)}>{row.status}</Status><span className="sv6-connection-cell"><strong>{row.connection}</strong><small>{row.relationship}</small></span><span className="sv6-visit-cell"><strong>{row.nextDate}</strong><small>{row.nextTime}</small></span><span className="sv6-activity-cell">{row.activity}</span><b>›</b></button>) : <div className="sv6-people-empty"><strong>{tab === "Relationships" ? "No pending relationship requests" : `No ${tab.toLowerCase()} found`}</strong><p>{tab === "Relationships" ? "New requests will appear here when submitted for this facility." : "Try a different name, visitor ID, or connection."}</p>{search || statusFilter !== "All statuses" || visitFilter !== "All visits" ? <Button onClick={() => { setSearch(""); setStatusFilter("All statuses"); setVisitFilter("All visits"); }}>Clear filters</Button> : null}</div>}
        <div className="sv6-directory-footer"><span>{loading ? "Loading records…" : `Showing ${filtered.length} of ${rows.length} loaded records`}</span><span>{truncated ? "First 250 records · directory display cap reached" : "Facility-scoped records"}</span></div>
      </section>
      <aside className="sv3-profile-teaser sv6-profile-teaser">{selected ? <><span className="sv3-eyebrow">Selected profile</span><div className="sv6-profile-hero"><Avatar initials={selected.initials} tone={selected.tone} /><div><h2>{selected.name}</h2><p>{selected.meta}</p><Status tone={statusTone(selected.status)}>{selected.status === "VERIFIED" ? "VERIFIED VISITOR" : selected.status}</Status></div></div><div className="sv6-profile-motif"><span /><i /><span /></div><div className="sv6-profile-sections"><div><dt>Connection</dt><dd><strong>{selected.connection}</strong><span>{selected.relationship}</span></dd></div><div><dt>Next visit</dt><dd><strong>{selected.nextDate}</strong><span>{selected.nextTime}</span></dd></div></div></> : <EmptyState title={loading ? "Loading profile" : "No profile selected"} body={loadError || "Select a facility record to inspect its current operational context."} />}</aside>
    </div>
  </div>;
}

