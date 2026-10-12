"use client";

import { useEffect, useState } from "react";
import { Avatar, Button, PageHeader, Status } from "../../components/ControlPrimitives";
import { mapBackendAppointment, type Appointment, type CheckState, type ReadinessCheck, type WaitingRecord, type WaitingState } from "./model";
import { formatDateValue } from "@/lib/date-format";

type Notice = { id: number; message: string; tone?: "success" | "warning" | "error" | "info" };

function buildWaitingChecks(appointment: Appointment, state: WaitingState, facilityState: string): ReadinessCheck[] {
  const notArrived = state === "NOT_ARRIVED";
  const technical = state === "TECHNICAL_ISSUE";
  const review = state === "STAFF_REVIEW";
  const facilityBlocked = facilityState !== "NORMAL_OPERATIONS";
  return [
    { key: "visitor", label: "Visitor present", detail: notArrived ? "Not checked in" : "Visitor is in the waiting room", state: notArrived ? "pending" : "pass" },
    { key: "prisoner", label: "Prisoner present", detail: notArrived ? "Unit confirmation pending" : review ? "Unit confirmation required" : "Prisoner is ready", state: notArrived || review ? "pending" : "pass" },
    { key: "identity", label: "Identity/session verified", detail: review ? "Relationship evidence needs review" : notArrived ? "Runs at check-in" : "Verified for this visit", state: review ? "warning" : notArrived ? "pending" : "pass" },
    { key: "camera", label: "Visitor camera test", detail: technical ? "Camera test needs retry" : notArrived ? "Runs at check-in" : "Camera signal healthy", state: technical ? "failed" : notArrived ? "pending" : "pass" },
    { key: "microphone", label: "Visitor microphone test", detail: technical ? "Microphone unavailable on assigned kiosk" : notArrived ? "Runs at check-in" : "Microphone signal healthy", state: technical ? "failed" : notArrived ? "pending" : "pass" },
    { key: "network", label: "Visitor connection test", detail: technical ? "Connection test failed; retry required" : notArrived ? "Runs at check-in" : "Latest persisted result is available", state: technical ? "failed" : notArrived ? "pending" : "pass" },
    { key: "room", label: "Room available", detail: facilityBlocked ? "Facility state requires supervisor review" : `${appointment.room} reserved for this window`, state: facilityBlocked ? "warning" : "pass" },
    { key: "kiosk", label: "Assigned kiosk online", detail: technical ? `${appointment.kiosk} is offline · alternative available` : `${appointment.kiosk} connected`, state: technical ? "failed" : "pass" },
    { key: "restriction", label: "No operational restriction", detail: facilityBlocked ? `Facility is ${facilityState.toLowerCase().replaceAll("_", " ")}` : "No active restriction", state: facilityBlocked ? "failed" : "pass" },
  ];
}

function buildWaitingRecord(appointment: Appointment, facilityState: string, override?: WaitingState): WaitingRecord | null {
  if (!["Approved", "Ready", "Requires action", "Blocked"].includes(appointment.status)) return null;
  const waitingState = override || (appointment.status === "Ready" ? "READY_TO_START" : appointment.status === "Requires action" ? "STAFF_REVIEW" : appointment.status === "Blocked" ? "TECHNICAL_ISSUE" : "NOT_ARRIVED");
  const checks = buildWaitingChecks(appointment, waitingState, facilityState);
  const visitorPresence = waitingState === "NOT_ARRIVED" ? "absent" : "present";
  const prisonerPresence = waitingState === "NOT_ARRIVED" || waitingState === "VISITOR_WAITING" || waitingState === "LATE" ? "waiting" : "present";
  const blocker = checks.find((check) => check.state === "failed" || check.state === "warning");
  const startAt = appointment.requestedStart ? Date.parse(appointment.requestedStart) : Number.NaN;
  const minutesToStart = Number.isFinite(startAt) ? Math.ceil((startAt - Date.now()) / 60_000) : null;
  const countdown = waitingState === "READY_TO_START" ? "READY NOW"
    : waitingState === "NOT_ARRIVED" ? minutesToStart === null ? "TIME NOT AVAILABLE" : minutesToStart > 0 ? `STARTS IN ${minutesToStart} MIN` : "CHECK-IN WINDOW OPEN"
      : waitingState === "LATE" ? minutesToStart === null ? "LATE" : minutesToStart < 0 ? `${Math.abs(minutesToStart)} MIN LATE` : "AWAITING CHECK-IN"
        : waitingState === "VISITOR_WAITING" ? "AWAITING PRISONER"
          : waitingState === "PRISONER_WAITING" ? "AWAITING VISITOR"
            : waitingState === "BOTH_PRESENT" ? "READINESS CHECKS"
              : waitingState.replaceAll("_", " ");
  return {
    ...appointment,
    waitingState,
    countdown,
    visitorPresence,
    prisonerPresence,
    verification: checks.find((check) => check.key === "identity")?.state || "pending",
    checks,
    blocker: blocker?.detail,
    lastUpdated: waitingState === "TECHNICAL_ISSUE" ? "Updated 4 min ago" : "Updated just now",
  };
}

type WaitingRoomApiRow = {
  id: string;
  appointment_status: string;
  requested_start: string;
  requested_end: string;
  timezone?: string | null;
  appointment_type?: string;
  appointment_version?: number;
  visitor_name?: string;
  prisoner_name?: string;
  prisoner_status?: string;
  visitation_status?: string;
  facility_state?: string;
  relationship_status?: string | null;
  state?: string | null;
  visitor_presence?: string | null;
  prisoner_presence?: string | null;
  identity_state?: CheckState | null;
  camera_state?: CheckState | null;
  microphone_state?: CheckState | null;
  network_state?: CheckState | null;
  room_state?: CheckState | null;
  kiosk_state?: CheckState | null;
  restriction_state?: CheckState | null;
  assigned_room_id?: string | null;
  assigned_kiosk_id?: string | null;
  assigned_room_name?: string | null;
  assigned_kiosk_name?: string | null;
  visitor_camera_result?: string | null;
  visitor_microphone_result?: string | null;
  visitor_network_result?: string | null;
  visitor_latency_ms?: number | null;
  visitor_device_checked_at?: string | null;
  staff_notes?: string | null;
  version?: number | null;
  last_checked_at?: string | null;
};

function hydrateWaitingRecord(base: WaitingRecord | null, row?: WaitingRoomApiRow): WaitingRecord | null {
  if (!base || !row) return base;
  if (row.state === "LIVE" || row.state === "CANCELLED") return null;
  const states = new Map<string, CheckState>([
    ["identity", row.identity_state || "pending"],
    ["camera", row.camera_state || "pending"], ["microphone", row.microphone_state || "pending"],
    ["network", row.network_state || "pending"], ["room", row.room_state || "pending"],
    ["kiosk", row.kiosk_state || "pending"], ["restriction", row.restriction_state || "pending"],
  ]);
  const checks = base.checks.map((check) => {
    const state = states.get(check.key) || "pending";
    const recordedAt = row.last_checked_at ? ` · checked ${formatDateValue(row.last_checked_at, { hour: "2-digit", minute: "2-digit" }, base.timezone, "time unavailable")}` : "";
    const result = check.key === "camera" ? row.visitor_camera_result : check.key === "microphone" ? row.visitor_microphone_result : check.key === "network" ? row.visitor_network_result : null;
    const resultLabel = result ? result.replaceAll("_", " ").toLowerCase() : null;
    const detail = state === "pass"
      ? check.key === "network" && row.visitor_latency_ms != null ? `Stable · ${row.visitor_latency_ms} ms${recordedAt}`
        : resultLabel ? `${resultLabel}${recordedAt}`
          : `Confirmed by the latest persisted readiness data${recordedAt}`
      : state === "failed"
        ? resultLabel ? `${resultLabel}${recordedAt}` : `A persisted readiness check is failing${recordedAt}`
        : state === "warning" ? `Requires staff review before this visit can start${recordedAt}`
          : "No current passing check is recorded";
    return { ...check, state, detail };
  });
  const validStates = ["NOT_ARRIVED", "VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT", "TECHNICAL_ISSUE", "STAFF_REVIEW", "READY_TO_START", "LATE", "LIVE"];
  const waitingState = row.state && validStates.includes(row.state) ? row.state as WaitingState : base.waitingState;
  return { ...base, waitingState, room: row.assigned_room_name || "Unassigned", kiosk: row.assigned_kiosk_name || "Unassigned", visitorPresence: row.visitor_presence === "present" ? "present" : "absent", prisonerPresence: row.prisoner_presence === "present" ? "present" : "waiting", checks, verification: states.get("identity") || "pending", blocker: row.staff_notes || checks.find((check) => check.state === "failed" || check.state === "warning")?.detail, lastUpdated: row.last_checked_at ? `Checked ${formatDateValue(row.last_checked_at, { hour: "2-digit", minute: "2-digit" }, base.timezone, "time unavailable")}` : "Not checked", backendVersion: Number(row.version || 1) };
}

export default function WaitingRoomPage({ facilityState, onNotify }: { facilityState: string; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [lane, setLane] = useState("all");
  const [query, setQuery] = useState("");
  const [windowFilter, setWindowFilter] = useState<"next_2_hours" | "today" | "all_approved">("next_2_hours");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serverVisits, setServerVisits] = useState<WaitingRoomApiRow[]>([]);
  const [windowNow, setWindowNow] = useState(0);
  const [lastSync, setLastSync] = useState("not synced");
  const [syncError, setSyncError] = useState("");
  async function refreshWaitingRoom() {
    const response = await fetch("/api/control/waiting-room", { headers: { accept: "application/json" }, credentials: "include" });
    if (!response.ok) throw new Error("Waiting Room data could not be refreshed from the staff API.");
    const body = await response.json() as { visits?: WaitingRoomApiRow[] };
    setServerVisits(body.visits || []);
    setWindowNow(Date.now());
    setLastSync(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    setSyncError("");
  }
  useEffect(() => {
    let active = true;
    const run = () => refreshWaitingRoom().catch((error) => setSyncError(error instanceof Error ? error.message : "Waiting Room data could not be refreshed."));
    run();
    const timer = window.setInterval(() => { if (active) { setWindowNow(Date.now()); run(); } }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const baseRecords = serverVisits.map((visit) => {
    const appointment = mapBackendAppointment({
      id: visit.id,
      visitor_name: visit.visitor_name,
      prisoner_name: visit.prisoner_name,
      requested_start: visit.requested_start,
      requested_end: visit.requested_end,
      timezone: visit.timezone,
      appointment_type: visit.appointment_type,
      status: visit.appointment_status,
      version: visit.appointment_version,
      room_name: visit.assigned_room_name,
      kiosk_name: visit.assigned_kiosk_name,
      relationship_status: visit.relationship_status,
      prisoner_status: visit.prisoner_status,
      visitation_status: visit.visitation_status,
      facility_state: visit.facility_state,
    });
    return hydrateWaitingRecord(buildWaitingRecord(appointment, visit.facility_state || facilityState), visit);
  }).filter((record): record is WaitingRecord => Boolean(record));
  const windowRecords = baseRecords.filter((record) => {
    const start = record.requestedStart ? Date.parse(record.requestedStart) : Number.NaN;
    const end = record.requestedEnd ? Date.parse(record.requestedEnd) : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return windowFilter === "all_approved";
    if (windowFilter === "all_approved") return true;
    const now = windowNow;
    if (windowFilter === "next_2_hours") return end >= now && start <= now + 2 * 60 * 60 * 1000;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: record.timezone || "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const visitDay = new Intl.DateTimeFormat("en-CA", { timeZone: record.timezone || "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(start));
    return day === visitDay && end >= now;
  });
  const records = windowRecords.filter((record) => `${record.visitor} ${record.prisoner} ${record.id} ${record.room} ${record.kiosk}`.toLowerCase().includes(query.toLowerCase())).filter((record) => !onlyAttention || ["TECHNICAL_ISSUE", "STAFF_REVIEW", "LATE"].includes(record.waitingState));
  const counts = {
    ready: windowRecords.filter((record) => record.waitingState === "READY_TO_START").length,
    waiting: windowRecords.filter((record) => ["VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT"].includes(record.waitingState)).length,
    attention: windowRecords.filter((record) => ["TECHNICAL_ISSUE", "STAFF_REVIEW", "LATE"].includes(record.waitingState)).length,
    upcoming: windowRecords.filter((record) => record.waitingState === "NOT_ARRIVED").length,
  };
  const laneFor = (state: WaitingState) => state === "READY_TO_START" ? "ready" : state === "NOT_ARRIVED" ? "upcoming" : ["TECHNICAL_ISSUE", "STAFF_REVIEW", "LATE"].includes(state) ? "attention" : "waiting";
  const laneRecords = (value: string) => records.filter((record) => value === "all" || laneFor(record.waitingState) === value);
  const selected = baseRecords.find((record) => record.id === selectedId) || null;

  async function action(record: WaitingRecord, kind: "admit" | "confirm_prisoner" | "checks" | "contact" | "late" | "cancel" | "start") {
    if (kind === "start" && (!record.checks.every((check) => check.state === "pass") || facilityState !== "NORMAL_OPERATIONS")) {
      onNotify("This visit cannot start until every pre-call check passes and the facility is operating normally.", "error");
      return;
    }
    const command = ({ admit: "admit_visitor", confirm_prisoner: "confirm_prisoner_presence", checks: "run_preflight", contact: "contact_visitor", late: "mark_late", cancel: "cancel_visit", start: "start_visit" } as const)[kind];
    try {
    const response = await fetch("/api/control/waiting-room", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `waiting-room-${record.id}-${record.backendVersion}-${command}` }, credentials: "include", body: JSON.stringify({ appointmentId: record.id, command, expectedVersion: record.backendVersion, reason: `Staff selected ${command.replaceAll("_", " ")} from the Waiting Room workflow.`, staffNotes: kind === "contact" ? "Staff contacted the assigned unit for a readiness update." : undefined }) });
      const body = await response.json() as { error?: string; state?: WaitingState };
      if (!response.ok) throw new Error(body.error === "VIDEO_PROVIDER_NOT_CONFIGURED" ? "LiveKit is not configured for this environment yet." : body.error || "Waiting Room action was rejected by the staff API.");
      await refreshWaitingRoom();
      onNotify(`${record.visitor} updated: ${command.replaceAll("_", " ")}.`, kind === "late" ? "warning" : "success");
      if (kind === "start" || kind === "cancel") setSelectedId(null);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Waiting Room action failed.", "error");
    }
  }

  function primaryAction(record: WaitingRecord) {
    if (record.waitingState === "READY_TO_START") return ["start", "Start Visit"] as const;
    if (record.waitingState === "TECHNICAL_ISSUE") return ["checks", "Recheck saved signals"] as const;
    if (record.waitingState === "STAFF_REVIEW") return ["checks", "Recheck eligibility"] as const;
    if (record.waitingState === "VISITOR_WAITING") return ["confirm_prisoner", "Confirm prisoner present"] as const;
    if (record.waitingState === "BOTH_PRESENT") return ["checks", "Evaluate readiness"] as const;
    if (record.waitingState === "NOT_ARRIVED" || record.waitingState === "PRISONER_WAITING" || record.waitingState === "LATE") return ["admit", "Admit visitor"] as const;
    return ["contact", "Contact visitor"] as const;
  }

  return <div className="sv8-waiting-page"><PageHeader eyebrow="Operations · Admission control" title="Waiting Room" description="Move approved appointments from arrival to a safe, verified handoff into Live Sessions." actions={<><Status tone={facilityState === "NORMAL_OPERATIONS" ? "green" : "red"}>{facilityState === "NORMAL_OPERATIONS" ? "ROOM OPEN" : "FACILITY REVIEW"}</Status><Button variant="primary" onClick={() => { void refreshWaitingRoom().then(() => onNotify("Readiness data refreshed from the staff API.", "success")).catch((error) => { const message = error instanceof Error ? error.message : "Refresh failed."; setSyncError(message); onNotify(message, "error"); }); }}>↻ Refresh readiness</Button></>} /><div className="sv8-summary"><button onClick={() => setLane("waiting")} className={lane === "waiting" ? "active" : ""}><span>Waiting now</span><strong>{counts.waiting}</strong><small>presence or unit confirmation</small></button><button onClick={() => setLane("ready")} className={lane === "ready" ? "active" : ""}><span>Ready to start</span><strong>{counts.ready}</strong><small>all checks passing</small></button><button onClick={() => setLane("attention")} className={lane === "attention" ? "active" : ""}><span>Needs attention</span><strong>{counts.attention}</strong><small>blockers or late arrivals</small></button><button onClick={() => setLane("upcoming")} className={lane === "upcoming" ? "active" : ""}><span>Upcoming</span><strong>{counts.upcoming}</strong><small>not yet in the window</small></button></div><section className="sv8-queue"><div className="sv8-toolbar"><label className="sv8-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visitor, prisoner, visit ID, room, or kiosk" /></label><label className="sv8-select"><span>Window</span><select aria-label="Waiting room time window" value={windowFilter} onChange={(event) => setWindowFilter(event.target.value as typeof windowFilter)}><option value="next_2_hours">Next 2 hours</option><option value="today">Today</option><option value="all_approved">All approved</option></select></label><button type="button" className={`sv8-attention-toggle ${onlyAttention ? "active" : ""}`} onClick={() => setOnlyAttention((current) => !current)}>Only needs attention</button><span className="sv8-toolbar-meta">{laneRecords(lane).length} linked visits · live readiness</span></div><div className="sv8-lane-tabs"><span>VIEW</span>{[["all", "All visits"], ["ready", "Ready to start"], ["waiting", "Waiting now"], ["attention", "Needs attention"], ["upcoming", "Upcoming"]].map(([value, label]) => <button className={lane === value ? "active" : ""} key={value} onClick={() => setLane(value)}>{label}{value !== "all" ? <em>{counts[value as keyof typeof counts]}</em> : null}</button>)}</div><div className="sv8-lanes">{[["ready", "READY TO START", "green"], ["waiting", "WAITING NOW", "blue"], ["attention", "NEEDS ATTENTION", "orange"], ["upcoming", "UPCOMING", "gray"]].map(([value, label, tone]) => <section className={`sv8-lane sv8-lane-${tone}`} key={value}><header><span><i />{label}</span><strong>{laneRecords(value).length}</strong></header><div className="sv8-lane-body">{laneRecords(value).map((record) => <article className={`sv8-card ${selectedId === record.id ? "selected" : ""}`} key={record.id}><button className="sv8-card-main" onClick={() => setSelectedId(record.id)}><div className="sv8-card-top"><Avatar initials={record.visitorInitials} tone={value === "attention" ? "orange" : value === "upcoming" ? "purple" : "blue"} /><span><strong>{record.visitor}</strong><small>{record.prisoner} · <span className="sv8-mono">{record.id}</span></small></span><Status tone={record.waitingState === "READY_TO_START" ? "green" : record.waitingState === "TECHNICAL_ISSUE" ? "red" : record.waitingState === "STAFF_REVIEW" || record.waitingState === "LATE" ? "orange" : "blue"}>{record.waitingState.replaceAll("_", " ")}</Status></div><div className="sv8-card-time"><strong>{record.date} · {record.time}</strong><span>{record.countdown}</span></div><div className="sv8-card-facts"><span>Visitor <b className={record.visitorPresence === "present" ? "pass" : "pending"}>{record.visitorPresence === "present" ? "Present" : "Not arrived"}</b></span><span>Prisoner <b className={record.prisonerPresence === "present" ? "pass" : "pending"}>{record.prisonerPresence === "present" ? "Present" : "Waiting"}</b></span><span>Resource <b>{record.room} · {record.kiosk}</b></span></div>{record.blocker ? <p className="sv8-blocker"><b>Blocker</b>{record.blocker}</p> : null}</button><div className="sv8-card-actions"><Button variant={primaryAction(record)[0] === "start" ? "primary" : "secondary"} onClick={() => action(record, primaryAction(record)[0])}>{primaryAction(record)[1]}</Button><button type="button" className="sv8-open-link" onClick={() => setSelectedId(record.id)}>Open readiness →</button></div></article>)}{!laneRecords(value).length ? <div className="sv8-lane-empty">No linked visits in this lane.</div> : null}</div></section>)}</div><footer className="sv8-footer"><span>Linked to the approved appointment queue · refreshes every 15 seconds in production.</span><strong>{syncError || `Last sync · ${lastSync}`}</strong></footer></section>{selected ? <div className="sv8-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}><aside className="sv8-drawer" role="dialog" aria-modal="true" aria-labelledby="waiting-drawer-title"><header className="sv8-drawer-head"><div><span className="sv8-kicker">{selected.id} · READINESS RECORD</span><h2 id="waiting-drawer-title">{selected.visitor}</h2><p>{selected.prisoner} · {selected.type} visit</p></div><button type="button" aria-label="Close readiness drawer" onClick={() => setSelectedId(null)}>×</button></header><div className="sv8-drawer-scroll"><div className="sv8-drawer-hero"><Avatar initials={selected.visitorInitials} tone="orange" /><div><strong>{selected.date} · {selected.time}</strong><small>{selected.room} · {selected.kiosk}</small></div><Status tone={selected.waitingState === "READY_TO_START" ? "green" : selected.waitingState === "TECHNICAL_ISSUE" ? "red" : "orange"}>{selected.waitingState.replaceAll("_", " ")}</Status></div><div className="sv8-drawer-callout"><span className="sv8-kicker">NEXT DECISION</span><strong>{selected.waitingState === "READY_TO_START" ? "Safe to start" : selected.blocker || "Waiting for arrival and facility confirmation"}</strong><p>{selected.waitingState === "READY_TO_START" ? "All required checks are passing. Starting this visit will hand it to the Live Sessions workspace." : "Resolve the highlighted blocker before starting the visit."}</p></div><section className="sv8-drawer-section"><header><span className="sv8-kicker">PRESENCE</span><span className="sv8-mono">{selected.countdown}</span></header><div className="sv8-presence-grid"><div><span>Visitor</span><strong className={selected.visitorPresence === "present" ? "pass" : "pending"}>{selected.visitorPresence === "present" ? "Present" : "Not arrived"}</strong></div><div><span>Prisoner</span><strong className={selected.prisonerPresence === "present" ? "pass" : "pending"}>{selected.prisonerPresence === "present" ? "Present" : "Waiting"}</strong></div></div></section><section className="sv8-drawer-section"><header><span className="sv8-kicker">PRE-CALL CHECKS</span><span className="sv8-check-score">{selected.checks.filter((check) => check.state === "pass").length}/{selected.checks.length} passing</span></header><div className="sv8-check-list">{selected.checks.map((check) => <div className="sv8-check-row" key={check.key}><span className={`sv8-check-icon ${check.state}`}>{check.state === "pass" ? "✓" : check.state === "failed" ? "×" : check.state === "warning" ? "!" : "·"}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div></section><section className="sv8-drawer-section"><header><span className="sv8-kicker">ASSIGNMENT</span></header><div className="sv8-detail-grid"><span><small>Room</small><strong>{selected.room}</strong></span><span><small>Kiosk</small><strong>{selected.kiosk}</strong></span><span><small>Visit ID</small><strong className="sv8-mono">{selected.id}</strong></span><span><small>Updated</small><strong>{selected.lastUpdated}</strong></span></div></section><section className="sv8-drawer-section"><header><span className="sv8-kicker">STAFF NOTES</span></header><p className="sv8-notes">{selected.issue || "No staff notes. Session is linked to the approved appointment and its reserved resources."}</p></section></div><footer className="sv8-drawer-actions"><Button variant="quiet" onClick={() => action(selected, "cancel")}>Cancel visit</Button><Button onClick={() => action(selected, "late")}>Mark late</Button><Button variant="primary" onClick={() => action(selected, primaryAction(selected)[0])} disabled={primaryAction(selected)[0] === "start" && selected.checks.some((check) => check.state !== "pass")}>{primaryAction(selected)[1]}</Button></footer></aside></div> : null}</div>;
}

