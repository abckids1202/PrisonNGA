"use client";

import { useState } from "react";
import { Button, EmptyState, PageHeader, Status } from "../../components/ControlPrimitives";
import { facilityTimeZoneLabel, type Appointment, type AppointmentStatus } from "./model";

type NoticeTone = "success" | "warning" | "error" | "info";

function appointmentReadiness(appointment: Appointment) {
  const checks = [
    appointment.relationshipStatus === "APPROVED",
    appointment.prisonerStatus === "ACTIVE" && appointment.visitationStatus === "APPROVED",
    appointment.facilityState === "NORMAL_OPERATIONS",
    appointment.activeCreditReservation || (appointment.availableCredits || 0) > 0,
    appointment.room !== "Unassigned",
    appointment.kiosk !== "Unassigned",
  ];
  const passed = checks.filter(Boolean).length;
  return { passed, total: checks.length, blocked: passed < checks.length || appointment.status === "Blocked" };
}

function appointmentDecisionAge(appointment: Appointment) {
  const source = appointment.status === "Requires action" ? appointment.createdAt : appointment.updatedAt || appointment.createdAt;
  if (!source) return "Age unavailable";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(source)) / 60_000));
  if (!Number.isFinite(elapsedMinutes)) return "Age unavailable";
  if (elapsedMinutes < 1) return "<1 min";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  return `${hours}h ${elapsedMinutes % 60}m`;
}

export default function AppointmentsPage({ appointments, onSelect, onNotify }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void; onNotify: (message: string, tone?: NoticeTone) => void }) {
  const [view, setView] = useState("Queue");
  const [filter, setFilter] = useState("Needs decision");
  const [query, setQuery] = useState("");
  const active = appointments.filter((appointment) => appointment.status !== "Completed");
  const needsDecision = active.filter((appointment) => ["Requires action", "Ready"].includes(appointment.status));
  const blocked = active.filter((appointment) => appointment.status === "Blocked");
  const filtered = (filter === "Needs decision" ? needsDecision : filter === "Blocked" ? blocked : active).filter((appointment) => `${appointment.visitor} ${appointment.prisoner} ${appointment.id}`.toLowerCase().includes(query.toLowerCase()));
  const statusLabel = (status: AppointmentStatus) => status === "Requires action" ? "Needs review" : status === "Ready" ? "Ready to approve" : status;
  const tone = (status: AppointmentStatus) => status === "Blocked" ? "red" : status === "Requires action" ? "orange" : status === "Live" ? "green" : "blue";
  return <div className="sv7-appointments-page"><PageHeader eyebrow="Operations · Appointments" title="Appointments" description="Review persisted visit requests and make decisions against the protected facility schedule." actions={<Button variant="primary" onClick={() => needsDecision[0] ? onSelect(needsDecision[0]) : onNotify("No persisted appointment currently requires a decision.", "info")} disabled={!needsDecision.length}>Review next decision</Button>} /><div className="sv7-appointment-summary"><button className={filter === "Needs decision" ? "active" : ""} onClick={() => setFilter("Needs decision")}><b>{needsDecision.length}</b><span>Needs review</span></button><i /><button className={filter === "Blocked" ? "active" : ""} onClick={() => setFilter("Blocked")}><b>{blocked.length}</b><span>Blocked</span></button><i /><button className={filter === "All active" ? "active" : ""} onClick={() => setFilter("All active")}><b>{active.length}</b><span>All active</span></button></div><div className="sv3-workspace-tabs sv7-appointment-tabs"><button className={view === "Queue" ? "active" : ""} onClick={() => setView("Queue")}>Queue <em>{filtered.length}</em></button><button className={view === "Timeline" ? "active" : ""} onClick={() => setView("Timeline")}>Timeline <em>{active.length}</em></button><button className={view === "Calendar" ? "active" : ""} onClick={() => setView("Calendar")}>Calendar</button></div>{view === "Queue" ? <section className="sv7-queue-surface"><div className="sv7-queue-toolbar"><div className="sv7-queue-search"><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visitor, prisoner, or visit ID" /></label></div><div className="sv7-queue-meta"><span>{filtered.length} persisted records</span><button onClick={() => { setQuery(""); setFilter("All active"); }}>Clear filters</button></div></div>{filtered.length ? <div className="sv7-queue-list" role="list"><div className="sv7-queue-head" aria-hidden="true"><span>Request</span><span>Participants</span><span>Requested time</span><span>Readiness</span><span>Decision age</span><span>Status</span><span>Action</span></div>{filtered.map((appointment) => { const readiness = appointmentReadiness(appointment); return <button role="listitem" className="sv7-queue-row" key={appointment.id} onClick={() => onSelect(appointment)}><span className="sv7-request-cell"><strong>{appointment.type} visit</strong><small>{appointment.id}</small></span><span className="sv7-participant-cell"><strong>{appointment.visitor} <i>↔</i> {appointment.prisoner}</strong><small>{appointment.issue || "Persisted appointment record"}</small></span><span className="sv7-time-cell"><strong>{appointment.date}</strong><small>{appointment.time} {appointment.timezoneLabel || facilityTimeZoneLabel(appointment.timezone || "Asia/Jakarta")}</small></span><span className={`sv7-readiness-cell ${readiness.blocked ? "warning" : "ready"}`}><strong>{readiness.blocked ? "!" : "✓"} {readiness.passed} / {readiness.total} ready</strong><small>{readiness.blocked ? "Eligibility, credit, or resources need review" : "Persisted checks are ready"}</small></span><span className="sv7-sla-cell">{appointmentDecisionAge(appointment)}</span><span><Status tone={tone(appointment.status)}>{statusLabel(appointment.status)}</Status></span><span className="sv7-row-action">Open <b>→</b></span></button>; })}</div> : <EmptyState title="No persisted appointments" body={query ? "No records match the current search." : "No appointment records are available in the current facility scope."} />}</section> : view === "Timeline" ? <TimelineView appointments={active} onSelect={onSelect} /> : <CalendarView appointments={active} onSelect={onSelect} />}</div>;
}

function TimelineView({ appointments, onSelect }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void }) {
  const [timelineFilter, setTimelineFilter] = useState("All");
  const filtered = timelineFilter === "All" ? appointments : appointments.filter((appointment) => timelineFilter === "Live" ? appointment.status === "Live" : timelineFilter === "Blocked" ? appointment.status === "Blocked" : timelineFilter === "Approved" ? ["Approved", "Ready"].includes(appointment.status) : appointment.status === "Completed");
  const dates = [...new Set(appointments.map((appointment) => appointment.date).filter(Boolean))];
  const assignedRooms = new Set(appointments.map((appointment) => appointment.room).filter((room) => room && room !== "Unassigned"));
  const dayLabel = dates.length === 1 ? dates[0] : dates.length > 1 ? `${dates[0]} – ${dates[dates.length - 1]}` : "No schedule date available";
  return <section className="sv7-timeline-surface"><div className="sv7-view-header"><div><span className="sv3-eyebrow">Persisted schedule · {dayLabel}</span><h2>Operational timeline</h2><p>{appointments.length} visits · {appointments.filter((appointment) => appointment.status === "Blocked").length} blocked · {assignedRooms.size} assigned rooms</p></div><div className="sv7-view-controls"><span className="sv7-toolbar-meta">Facility API window</span></div></div><div className="sv7-timeline-filters">{["All", "Approved", "Blocked", "Live", "Completed"].map((item) => <button className={timelineFilter === item ? "active" : ""} key={item} onClick={() => setTimelineFilter(item)}>{item}</button>)}</div><div className="sv7-vertical-timeline">{filtered.map((appointment) => <button className={`sv7-timeline-event ${appointment.status === "Completed" ? "completed" : ""}`} key={appointment.id} onClick={() => onSelect(appointment)}><time>{appointment.time.split("–")[0]}</time><span className={`sv7-timeline-node ${appointment.status === "Blocked" ? "blocked" : appointment.status === "Live" ? "live" : "ready"}`} /><span className="sv7-timeline-event-body"><span><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "blue"}>{appointment.status === "Requires action" ? "NEEDS REVIEW" : appointment.status.toUpperCase()}</Status><em>{appointment.room} · {appointment.kiosk}</em></span><strong>{appointment.visitor} ↔ {appointment.prisoner}</strong><small>{appointment.type} Visit · {appointment.issue || "All required checks passed"}</small></span><b>›</b></button>)}</div>{!filtered.length ? <EmptyState title="No visits in this timeline" body="No persisted appointments match the selected status filter." /> : null}</section>;
}

function CalendarView({ appointments, onSelect }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void }) {
  return <section className="sv7-calendar-surface"><div className="sv7-view-header"><div><span className="sv3-eyebrow">Planning horizon · persisted schedule</span><h2>Schedule calendar</h2><p>Only appointments returned by the protected facility API appear here.</p></div><div className="sv7-calendar-summary"><strong>{appointments.length}</strong><span>loaded visits<br />capacity unavailable</span></div></div>{appointments.length ? <div className="sv7-vertical-timeline">{appointments.map((appointment) => <button className="sv7-timeline-event" key={appointment.id} onClick={() => onSelect(appointment)}><time>{appointment.time}</time><span className="sv7-timeline-node ready" /><span className="sv7-timeline-event-body"><span><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "blue"}>{appointment.status}</Status><em>{appointment.room} · {appointment.kiosk}</em></span><strong>{appointment.visitor} ↔ {appointment.prisoner}</strong><small>{appointment.date} · {appointment.type} Visit</small></span><b>›</b></button>)}</div> : <EmptyState title="No scheduled visits loaded" body="Connect an authenticated staff API to load the facility schedule." />}</section>;
}
