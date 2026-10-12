"use client";

import { useEffect, useState } from "react";
import { EmptyState, Metric, Status } from "../../components/ControlPrimitives";
import { AlertDialog } from "./DecisionDialogs";
import { CapacityPopover, SessionPopover, WaitingPopover, type OperationalLiveSession, type OperationalWaitingVisit } from "./OperationalPopovers";
import { type Appointment } from "./model";
import type { DrawerPayload } from "./ContextDrawer";

type Notice = { id: number; message: string; tone?: "success" | "warning" | "error" | "info" };
type AuditEvent = { id: string; actionType: string; entityType: string; entityId: string | null; reason: string | null; oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null; actorRole: string | null; correlationId: string; createdAt: string };
type PopoverKind = "capacity" | "waiting" | "session" | "demo" | null;
type DrawerInput = DrawerPayload | { kind: "appointment" | "activity"; appointment?: Appointment; event?: string; source?: string; relatedId?: string };
type ResourceApiRow = { id: string; resource_type: "ROOM" | "DEVICE"; display_name: string; status: string; room_id?: string | null; health_state: string; last_heartbeat_at?: string | null; active_appointment_id?: string | null; waiting_version?: number | null; has_active_kiosk_credential?: number; kiosk_credential_last_used_at?: string | null; version: number };

export default function CommandCenterPage({ appointments, facilityName, facilityTimezone, now, facilityState, backendStatus, demoMode, simulationPaused, simulationTick, onFacilityStateChange, onPause, onAdvance, onNavigate, onOpenDrawer, onOpenAppointment, onOpenPopover, onNotify, popover }: { appointments: Appointment[]; facilityName: string; facilityTimezone: string; now: Date; facilityState: string; backendStatus: "connected" | "unavailable"; demoMode: boolean; simulationPaused: boolean; simulationTick: number; onFacilityStateChange: (state: string, reason?: string) => Promise<void>; onPause: () => void; onAdvance: () => void; onNavigate: (page: string) => void; onOpenDrawer: (payload: DrawerInput) => void; onOpenAppointment: (appointment: Appointment) => void; onOpenPopover: (kind: Exclude<PopoverKind, null>) => void; onNotify: (message: string, tone?: Notice["tone"]) => void; popover: PopoverKind }) {
  const lockdown = facilityState === "LOCKDOWN";
  const facilityRestricted = facilityState !== "NORMAL_OPERATIONS" && facilityState !== "UNKNOWN";
  const [lockdownDialog, setLockdownDialog] = useState(false);
  const [propagating, setPropagating] = useState(false);
  const [scenario, setScenario] = useState("Normal day");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState(false);
  const [resources, setResources] = useState<ResourceApiRow[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourcesError, setResourcesError] = useState(false);
  const [waitingVisits, setWaitingVisits] = useState<OperationalWaitingVisit[]>([]);
  const [waitingLoading, setWaitingLoading] = useState(true);
  const [waitingError, setWaitingError] = useState(false);
  const [liveSessions, setLiveSessions] = useState<OperationalLiveSession[]>([]);
  const [liveSessionsLoading, setLiveSessionsLoading] = useState(true);
  const [liveSessionsError, setLiveSessionsError] = useState(false);
  useEffect(() => {
    let active = true;
    const loadAuditEvents = async () => {
      try {
        const response = await fetch("/api/audit/events?limit=6", { cache: "no-store", headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("AUDIT_UNAVAILABLE");
        const body = await response.json() as { events?: AuditEvent[] };
        if (active) { setAuditEvents(Array.isArray(body.events) ? body.events : []); setAuditError(false); }
      } catch {
        if (active) { setAuditEvents([]); setAuditError(true); }
      } finally {
        if (active) setAuditLoading(false);
      }
    };
    void loadAuditEvents();
    const timer = window.setInterval(loadAuditEvents, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    const loadLiveSessions = async () => {
      try {
        const response = await fetch("/api/control/live-sessions", { cache: "no-store", headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("LIVE_SESSIONS_UNAVAILABLE");
        const body = await response.json() as { sessions?: OperationalLiveSession[] };
        if (active) { setLiveSessions(Array.isArray(body.sessions) ? body.sessions : []); setLiveSessionsError(false); }
      } catch {
        if (active) { setLiveSessions([]); setLiveSessionsError(true); }
      } finally {
        if (active) setLiveSessionsLoading(false);
      }
    };
    void loadLiveSessions();
    const timer = window.setInterval(loadLiveSessions, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    const loadWaitingVisits = async () => {
      try {
        const response = await fetch("/api/control/waiting-room", { cache: "no-store", headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("WAITING_ROOM_UNAVAILABLE");
        const body = await response.json() as { visits?: OperationalWaitingVisit[] };
        if (active) { setWaitingVisits(Array.isArray(body.visits) ? body.visits : []); setWaitingError(false); }
      } catch {
        if (active) { setWaitingVisits([]); setWaitingError(true); }
      } finally {
        if (active) setWaitingLoading(false);
      }
    };
    void loadWaitingVisits();
    const timer = window.setInterval(loadWaitingVisits, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    const loadResources = async () => {
      try {
        const response = await fetch("/api/control/resources", { cache: "no-store", headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("RESOURCES_UNAVAILABLE");
        const body = await response.json() as { resources?: ResourceApiRow[] };
        if (active) { setResources(Array.isArray(body.resources) ? body.resources : []); setResourcesError(false); }
      } catch {
        if (active) { setResources([]); setResourcesError(true); }
      } finally {
        if (active) setResourcesLoading(false);
      }
    };
    void loadResources();
    const timer = window.setInterval(loadResources, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const blocked = appointments.filter((appointment) => appointment.status === "Blocked");
  const attention = appointments.filter((appointment) => appointment.status === "Requires action" || appointment.status === "Blocked").length + (facilityRestricted ? 1 : 0);
  const rooms = resources.filter((resource) => resource.resource_type === "ROOM");
  const occupiedRooms = rooms.filter((resource) => resource.active_appointment_id || resource.status === "IN_USE").length;
  const roomCapacity = resourcesLoading || resourcesError ? "—" : `${occupiedRooms} / ${rooms.length}`;
  const waitingNow = waitingVisits.filter((visit) => ["VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT"].includes(visit.state || visit.readiness?.state || "")).length;
  // A facility restriction blocks new transitions, but it does not itself
  // terminate an already-running session. Keep persisted sessions visible so
  // staff can explicitly observe or terminate them.
  const activeSessions = liveSessions;
  const upcomingVisits = appointments.filter((appointment) => !["Completed", "Blocked"].includes(appointment.status)).length;
  const waitingVisitors = waitingVisits.filter((visit) => ["VISITOR_WAITING", "BOTH_PRESENT", "READY_TO_START"].includes(visit.state || visit.readiness?.state || "")).length;
  const activeKiosks = resources.filter((resource) => resource.resource_type === "DEVICE" && (resource.active_appointment_id || resource.status === "IN_USE")).length;
  const resourcesUnavailable = resourcesLoading || resourcesError;
  const waitingUnavailable = waitingLoading || waitingError;
  const sessionsUnavailable = liveSessionsLoading || liveSessionsError;
  const operationalDataUnavailable = backendStatus !== "connected";
  const operationalRecordLabel = operationalDataUnavailable ? "Persisted visit data unavailable" : `${appointments.length} persisted record${appointments.length === 1 ? "" : "s"} · sorted by time and urgency`;
  const lockdownStats = [
    `${operationalDataUnavailable ? "Unknown" : upcomingVisits} upcoming visits require review`,
    `${operationalDataUnavailable || waitingUnavailable ? "Unknown" : waitingVisitors} visitors currently waiting`,
    `${operationalDataUnavailable || resourcesUnavailable ? "Unknown" : occupiedRooms} rooms currently in use`,
    `${operationalDataUnavailable || resourcesUnavailable ? "Unknown" : activeKiosks} kiosks currently in use`,
  ];
  const nextDecision = appointments.find((appointment) => appointment.status === "Requires action") || appointments.find((appointment) => appointment.status === "Ready");
  const timeline = appointments.slice(0, 4).map((appointment, index) => {
    const status = appointment.status === "Live" ? "LIVE" : appointment.status === "Completed" ? "COMPLETED" : appointment.status === "Blocked" || appointment.status === "Requires action" ? "BLOCKED" : appointment.status === "Ready" ? "READY" : "APPROVED";
    const tone = status === "COMPLETED" ? "green" : status === "LIVE" ? "orange" : status === "BLOCKED" ? "red" : "blue";
    const line = status === "COMPLETED" ? "done" : status === "LIVE" ? "live" : status === "BLOCKED" ? "blocked" : "ready";
    const meta = `${facilityRestricted ? `Facility state ${facilityState.toLowerCase().replaceAll("_", " ")} · ` : ""}${appointment.room} · ${appointment.type} visit${appointment.issue ? ` · ${appointment.issue}` : ""}`;
    return { time: appointment.time.split("–")[0], status, tone, line, title: `${appointment.visitor} ↔ ${appointment.prisoner}`, meta, appointment, action: status === "LIVE" ? "Monitor" : status === "COMPLETED" ? "View details" : status === "BLOCKED" ? "Resolve" : index === 0 ? "Review" : "Open" };
  });

  async function confirmLockdown(reason: string, details: string) {
    setLockdownDialog(false);
    setPropagating(true);
    try {
      await onFacilityStateChange("LOCKDOWN", `${reason}: ${details}`);
      onNotify("Facility response recorded. Approvals are suspended while staff review affected visits.", "warning");
      window.setTimeout(() => { setPropagating(false); onNotify("Lockdown active. Affected visits remain available for staff review.", "warning"); }, 1300);
    } catch (error) {
      setPropagating(false);
      onNotify(error instanceof Error ? error.message : "The facility restriction was not saved.", "error");
    }
  }

  async function restoreOperations() {
    setPropagating(true);
    try {
      await onFacilityStateChange("NORMAL_OPERATIONS", "Staff supervisor restored normal facility operations.");
      onNotify("Normal operations restored and persisted to the facility record.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Normal operations could not be restored.", "error");
    } finally {
      setPropagating(false);
    }
  }

  function handleScenario(value: string) {
    setScenario(value);
    if (value === "Facility lockdown") {
      setLockdownDialog(true);
      return;
    }
    onNotify(`${value} scenario loaded. Operational data remains scoped to the protected facility API.`, "info");
  }

  return <>
    <div className={`sv3-command-band sv6-command-hero ${facilityRestricted ? "sv3-command-band-lockdown" : ""} ${propagating ? "sv3-state-propagating" : ""}`}><div><span className="sv3-eyebrow">{facilityName} · Operations</span><h1>{facilityRestricted ? facilityState.replaceAll("_", " ") : "Command Center"}</h1><p>{facilityRestricted ? "New visit approvals and admissions are suspended while the facility restriction is active." : "Live operations across today&apos;s visitation program."}</p><div className="sv6-hero-meta"><span><i className="sv6-pulse-dot" />{backendStatusLabel(facilityRestricted, backendStatus)}</span><span>Facility time <b suppressHydrationWarning>{new Intl.DateTimeFormat("en-ID", { hour: "2-digit", minute: "2-digit", timeZone: facilityTimezone }).format(now)}</b></span></div></div><div className="sv3-command-state"><Status tone={facilityRestricted ? "red" : backendStatus === "connected" ? "green" : "orange"}>{facilityRestricted ? facilityState.replaceAll("_", " ") : backendStatus === "connected" ? "NORMAL OPERATIONS" : "API UNAVAILABLE"}</Status><strong suppressHydrationWarning>{new Intl.DateTimeFormat("en-ID", { hour: "2-digit", minute: "2-digit", timeZone: facilityTimezone }).format(now)}</strong><small>{facilityTimezone}</small></div></div>
    {facilityRestricted ? <div className="sv3-lockdown-strip"><strong>Facility restriction active</strong><span>New approvals and admissions are suspended · {upcomingVisits} visits require review · {operationalDataUnavailable || waitingUnavailable ? "Unknown" : waitingVisitors} visitors waiting · {operationalDataUnavailable || sessionsUnavailable ? "Unknown" : activeSessions.length} live session{!operationalDataUnavailable && !sessionsUnavailable && activeSessions.length === 1 ? "" : "s"} remain visible for controlled termination · no automatic credit settlement</span></div> : null}
    <div className="sv3-command-metrics sv6-command-metrics"><Metric label="Live sessions" value={liveSessionsLoading || liveSessionsError ? "—" : String(activeSessions.length)} detail={facilityRestricted ? "Persisted sessions require review" : liveSessionsLoading ? "Loading session data" : liveSessionsError ? "Live Session data unavailable" : "Persisted active sessions"} tone="orange" onClick={() => onOpenPopover("session")} /><Metric label="Waiting room" value={waitingLoading || waitingError ? "—" : String(waitingNow)} detail={facilityRestricted ? "New admissions suspended" : waitingLoading ? "Loading readiness data" : waitingError ? "Waiting Room data unavailable" : "Persisted presence states"} tone="blue" onClick={() => onOpenPopover("waiting")} /><Metric label="Requires attention" value={operationalDataUnavailable ? "—" : String(attention)} detail={facilityRestricted ? "Restriction requires review" : operationalDataUnavailable ? "Protected appointment data unavailable" : "Persisted blockers and review"} tone="red" onClick={() => document.querySelector(".sv3-attention-surface")?.scrollIntoView({ behavior: "smooth", block: "center" })} /><Metric label="Rooms in use" value={roomCapacity} detail={resourcesLoading ? "Loading facility resources" : resourcesError ? "Facility resource data unavailable" : rooms.length ? `${rooms.length} rooms · live resource data` : "No room data available"} tone="green" onClick={() => onOpenPopover("capacity")} />{popover === "session" ? <SessionPopover sessions={activeSessions} loading={liveSessionsLoading} unavailable={liveSessionsError} onOpen={() => onNavigate("Live Sessions")} /> : popover === "waiting" ? <WaitingPopover visits={waitingVisits} loading={waitingLoading} unavailable={waitingError} onOpen={() => onNavigate("Waiting Room")} /> : popover === "capacity" ? <CapacityPopover resources={resources} loading={resourcesLoading} unavailable={resourcesError} onOpen={() => onNavigate("Resources")} /> : null}</div>
    {demoMode ? <div className="sv3-simulation-bar sv6-simulation-bar"><div className="sv6-simulation-status"><span><i className={simulationPaused ? "paused" : ""} />Development simulation</span><strong>{simulationPaused ? "Paused" : "Running"}</strong></div><label className="sv6-simulation-field">Scenario<select value={scenario} onChange={(event) => handleScenario(event.target.value)}><option>Normal day</option><option>Busy morning</option><option>Device failure</option><option>Visitor no-show</option><option>Facility lockdown</option><option>Technical failure</option><option>Security incident</option></select></label><span className="sv6-simulation-speed">Speed <b>1×</b></span><div className="sv6-simulation-actions"><button onClick={onPause}> {simulationPaused ? "Resume" : "Pause"}</button><button onClick={onAdvance}>Advance event</button><button onClick={() => onNotify("Scenario library is available only in the development environment.")}>Scenarios</button><button onClick={() => void (lockdown ? restoreOperations() : setLockdownDialog(true))} className="danger-link">{lockdown ? "Restore facility" : "Test lockdown"}</button></div><small>Development event {String(3 + simulationTick).padStart(2, "0")} · {simulationTick ? "Local event only" : "Normal day scenario"}</small></div> : null}
    <div className="sv6-operations-label"><div><span className="sv3-eyebrow">Decision surface</span><strong>Act on the next operational moment</strong></div><span>{operationalRecordLabel}</span></div>
    <div className="sv3-command-layout"><section className="sv3-surface sv3-timeline-surface sv6-timeline-surface"><div className="sv3-surface-head"><div><span className="sv3-eyebrow" aria-label="Today&apos;s operational timeline">Operational timeline</span><h2>Persisted visits</h2></div><button className="sv3-link-button" onClick={() => onNavigate("Appointments")}>Open appointments →</button></div><div className="sv3-timeline">{timeline.length ? timeline.map((item) => <div className={`sv3-timeline-row sv3-timeline-row-interactive ${item.status === "BLOCKED" ? "timeline-blocked" : ""}`} key={item.time} role="button" tabIndex={0} onClick={() => item.appointment && onOpenAppointment(item.appointment)} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && item.appointment) { event.preventDefault(); onOpenAppointment(item.appointment); } }}><time>{item.time}</time><span className={`sv3-timeline-line ${item.line}`} /><div className="sv6-timeline-content"><div className="sv6-timeline-topline"><button type="button" className="sv3-timeline-status" onClick={(event) => { event.stopPropagation(); if (item.appointment) onOpenDrawer({ kind: item.status.includes("LIVE") ? "activity" : "appointment", ...(item.status.includes("LIVE") ? { event: `${item.appointment.visitor} ↔ ${item.appointment.prisoner}`, source: "Live session", relatedId: item.appointment.id } : { appointment: item.appointment }) }); }}><Status tone={item.tone}>{item.status}</Status></button><button type="button" className="sv6-row-action" onClick={(event) => { event.stopPropagation(); if (item.appointment) onOpenAppointment(item.appointment); }}>{item.action} <span>→</span></button></div><strong>{item.title.split(" ↔ ")[0]} {item.title.includes("↔") ? `↔ ${item.title.split(" ↔ ")[1]}` : ""}</strong><small>{item.meta}</small></div></div>) : <EmptyState title="No persisted visits loaded" body={backendStatus === "connected" ? "The facility has no appointments in this operational window." : "Connect an authenticated staff API to load the facility schedule."} action="Open appointments" />}</div></section><aside className="sv3-attention-rail"><div className="sv3-surface sv3-attention-surface sv6-attention-surface" id="action-center"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Priority queue</span><h2>Requires attention</h2></div><span className="sv3-count-badge">{attention}</span></div>{nextDecision ? <button className="sv3-action-row" onClick={() => onOpenAppointment(nextDecision)}><span className="sv3-action-icon amber">!</span><span><strong>Visit requires review</strong><small>{nextDecision.id} · staff decision pending</small></span><b>›</b><em>Review queue</em></button> : null}{blocked[0] ? <button className="sv3-action-row" onClick={() => onOpenAppointment(blocked[0])}><span className="sv3-action-icon red">×</span><span><strong>Visit is blocked</strong><small>{blocked[0].id} · {blocked[0].issue || "Operational blocker"}</small></span><b>›</b><em>Resolve</em></button> : null}{!attention ? <EmptyState title="No attention items" body={backendStatus === "connected" ? "No persisted visits currently require staff action." : "Attention items will appear after the protected API connects."} /> : null}</div><div className="sv3-surface sv3-feed-surface sv6-feed-surface"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Activity</span><h2>Operational history</h2></div></div>{auditLoading ? <EmptyState title="Loading operational history" body="Fetching the latest facility audit events." /> : auditError ? <EmptyState title="Activity feed unavailable" body="The protected audit feed could not be reached. Try again after staff access is restored." /> : auditEvents.length ? auditEvents.map((event) => <button type="button" className="sv3-feed-row sv3-feed-row-interactive" key={event.id} onClick={() => onOpenDrawer({ kind: "activity", event: formatAuditEvent(event), source: `${event.entityType} · ${event.actionType}`, relatedId: event.entityId || event.correlationId })}><time>{formatAuditTime(event.createdAt, facilityTimezone)}</time><span><strong>{formatAuditEvent(event)}</strong><small>{event.entityType}{event.entityId ? ` · ${event.entityId}` : ""} · {event.actorRole || "System"}</small></span><b>›</b></button>) : <EmptyState title="No activity recorded" body="New decisions, session events, and operational changes will appear here." />}</div></aside></div>
    {lockdownDialog ? <AlertDialog title="Declare facility lockdown" description="This suspends new approvals across the facility. Existing visits are not silently cancelled or refunded; staff must review each affected appointment." stats={lockdownStats} onCancel={() => setLockdownDialog(false)} onConfirm={confirmLockdown} /> : null}
  </>;
}

function backendStatusLabel(lockdown: boolean, backendStatus: "connected" | "unavailable") {
  return lockdown ? "Response in progress" : backendStatus === "connected" ? "Protected API reporting" : "Protected API unavailable";
}

function formatAuditEvent(event: AuditEvent) {
  const action = event.actionType.replaceAll("_", " ").toLowerCase();
  const entity = event.entityType.replaceAll("_", " ").toLowerCase();
  return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${entity}`;
}

function formatAuditTime(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-ID", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
