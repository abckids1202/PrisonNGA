"use client";

import { useEffect, useState, type ReactNode } from "react";

type Mode = "operations" | "management";
type AppointmentStatus = "Requires action" | "Ready" | "Live" | "Blocked" | "Completed" | "Approved";
type WaitingState = "NOT_ARRIVED" | "VISITOR_WAITING" | "PRISONER_WAITING" | "BOTH_PRESENT" | "TECHNICAL_ISSUE" | "STAFF_REVIEW" | "READY_TO_START" | "LATE" | "LIVE";
type CheckState = "pass" | "warning" | "failed" | "pending";
type ReadinessCheck = { key: string; label: string; detail: string; state: CheckState };
type WaitingRecord = Appointment & {
  waitingState: WaitingState;
  countdown: string;
  visitorPresence: "present" | "waiting" | "absent";
  prisonerPresence: "present" | "waiting" | "absent";
  verification: CheckState;
  checks: ReadinessCheck[];
  blocker?: string;
  lastUpdated: string;
};
type Appointment = {
  id: string;
  visitor: string;
  visitorInitials: string;
  prisoner: string;
  time: string;
  date: string;
  room: string;
  kiosk: string;
  type: "Family" | "Legal";
  status: AppointmentStatus;
  issue?: string;
};
type PeopleRecord = {
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

type Notice = { id: number; message: string; tone?: "success" | "warning" | "error" | "info" };
type PopoverKind = "capacity" | "waiting" | "session" | "demo" | null;
type DrawerPayload =
  | { kind: "appointment"; appointment: Appointment }
  | { kind: "device"; device: "Kiosk 04" }
  | { kind: "waiting"; visitor: "Sarah Amelia" | "Nurul Hidayah" }
  | { kind: "incident"; id: string }
  | { kind: "activity"; event: string; source: string; relatedId: string };

const operationsNav = [
  ["Command Center", "⌂"],
  ["Appointments", "◈"],
  ["Waiting Room", "◌"],
  ["Live Sessions", "◉"],
  ["Resources", "▦"],
  ["Incidents", "!"],
] as const;

const managementNav = [
  ["People", "♙"],
  ["Visitation", "◫"],
  ["Finance", "¤"],
  ["Compliance", "≡"],
  ["Facility", "⌘"],
  ["Administration", "⚙"],
] as const;

const initialAppointments: Appointment[] = [
  { id: "SV-260813-031", visitor: "Sarah Amelia", visitorInitials: "SA", prisoner: "A. Rahman", time: "10:00–10:20", date: "Today", room: "Room 03", kiosk: "Kiosk 04", type: "Family", status: "Live" },
  { id: "SV-260813-032", visitor: "Daniel Wijaya", visitorInitials: "DW", prisoner: "R. Santoso", time: "10:20–10:40", date: "Today", room: "Room 01", kiosk: "Kiosk 02", type: "Family", status: "Ready" },
  { id: "SV-260813-033", visitor: "Alya Pratama", visitorInitials: "AP", prisoner: "F. Pratama", time: "10:40–11:00", date: "Today", room: "Room 04", kiosk: "Kiosk 06", type: "Family", status: "Requires action", issue: "Relationship evidence needs review" },
  { id: "SV-260813-034", visitor: "Dimas Wirawan", visitorInitials: "DW", prisoner: "B. Aditya", time: "11:20–11:40", date: "Today", room: "Room 02", kiosk: "Kiosk 03", type: "Legal", status: "Blocked", issue: "Visitor device test failed" },
  { id: "SV-260814-018", visitor: "Nurul Hidayah", visitorInitials: "NH", prisoner: "F. Hidayat", time: "09:00–09:20", date: "Tomorrow", room: "Room 02", kiosk: "Kiosk 03", type: "Family", status: "Approved" },
];

const activities = [
  ["09:54", "Kiosk 06 assigned to SV-260813-033", "Resource desk"],
  ["09:51", "A. Rahman confirmed for the 10:00 visit", "Unit 4"],
  ["09:48", "Sarah Amelia completed device check", "Visitor portal"],
  ["09:46", "Waiting room opened for the morning schedule", "System"],
] as const;

function Avatar({ initials, tone = "blue" }: { initials: string; tone?: string }) {
  return <span className={`sv3-avatar sv3-avatar-${tone}`}>{initials}</span>;
}

function Status({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`sv3-status sv3-status-${tone || String(children).toLowerCase().replaceAll(" ", "-")}`}><i />{children}</span>;
}

function Button({ children, variant = "secondary", onClick, disabled = false }: { children: ReactNode; variant?: "primary" | "secondary" | "quiet" | "danger"; onClick?: () => void; disabled?: boolean }) {
  return <button className={`sv3-button sv3-button-${variant}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Metric({ label, value, detail, tone = "default", onClick }: { label: string; value: string; detail: string; tone?: string; onClick?: () => void }) {
  const content = <><span>{label}</span><strong>{value}</strong><small>{detail}</small></>;
  return onClick ? <button type="button" className={`sv3-metric sv3-metric-${tone} sv3-metric-interactive`} onClick={onClick}>{content}</button> : <div className={`sv3-metric sv3-metric-${tone}`}>{content}</div>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="sv3-section-label">{children}</div>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="sv3-page-header"><div><span className="sv3-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions ? <div className="sv3-header-actions">{actions}</div> : null}</header>;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: string }) {
  return <div className="sv3-empty"><span>◌</span><strong>{title}</strong><p>{body}</p>{action ? <Button variant="secondary">{action}</Button> : null}</div>;
}

function SecureVisitLogo({ markOnly = false }: { markOnly?: boolean }) {
  return <div className={`sv6-logo-lockup ${markOnly ? "sv6-logo-mark-only" : ""}`} aria-label="SecureVisit Control">
    <svg className="sv6-logo-mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 10v20M32 10v20M8 20h7M25 20h7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="4" /><path d="M15 20c2.2-5.4 7.8-5.4 10 0" fill="none" stroke="#F26B38" strokeLinecap="round" strokeWidth="4" /><circle cx="8" cy="20" r="2.3" fill="#F26B38" /><circle cx="32" cy="20" r="2.3" fill="#F26B38" /></svg>
    {!markOnly ? <span><strong>SecureVisit</strong><small>CONTROL</small></span> : null}
  </div>;
}

export default function ControlApp() {
  const [mode, setMode] = useState<Mode>("operations");
  const [page, setPage] = useState("Command Center");
  const [appointments, setAppointments] = useState(initialAppointments);
  const [facilityState, setFacilityState] = useState("NORMAL_OPERATIONS");
  const [facilityVersion, setFacilityVersion] = useState(1);
  const [backendStatus, setBackendStatus] = useState<"connected" | "demo">("demo");
  const [simulationPaused, setSimulationPaused] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState("INC-260813-019");
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedDrawer, setSelectedDrawer] = useState<DrawerPayload | null>(null);
  const [approvalAppointment, setApprovalAppointment] = useState<Appointment | null>(null);
  const [popover, setPopover] = useState<PopoverKind>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [simulationTick, setSimulationTick] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setPopover(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/facility/state", { headers: { accept: "application/json" } }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      if (active && body.facility) {
        setFacilityState(body.facility.currentState);
        setFacilityVersion(body.facility.version);
        setBackendStatus("connected");
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  function notify(message: string, tone: Notice["tone"] = "info") {
    const id = Date.now();
    setNotices((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 4200);
  }

  async function changeFacilityState(nextState: string) {
    const previousState = facilityState;
    const nextVersion = facilityVersion + 1;
    setFacilityState(nextState);
    setFacilityVersion(nextVersion);
    try {
      const response = await fetch("/api/facility/state", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ state: nextState, expectedVersion: facilityVersion, reason: nextState === "LOCKDOWN" ? "Demo supervisor declared a controlled facility lockdown." : "Demo supervisor restored normal operations." }) });
      if (response.ok) {
        const body = await response.json();
        setFacilityVersion(body.facility?.version || nextVersion);
        setBackendStatus("connected");
        notify(nextState === "LOCKDOWN" ? "Facility lockdown declared and audit event created." : "Facility returned to normal operations.", nextState === "LOCKDOWN" ? "warning" : "success");
      } else {
        notify("Demo state changed locally; authenticated staff API is not connected in this preview.", "info");
      }
    } catch {
      setFacilityState(nextState);
      notify(`Demo state changed to ${nextState === "LOCKDOWN" ? "lockdown" : "normal operations"}.`, "info");
    }
    if (previousState === nextState) notify("No facility state change was needed.");
  }

  function updateAppointment(id: string, status: AppointmentStatus) {
    setAppointments((current) => current.map((appointment) => appointment.id === id ? { ...appointment, status, issue: undefined } : appointment));
    notify(status === "Approved" ? "Visit approved. Room, kiosk, credit, and audit actions queued." : `Visit marked ${status.toLowerCase()}.`, status === "Approved" ? "success" : "warning");
    setSelectedAppointment(null);
    setApprovalAppointment(null);
  }

  function reassignAppointment(id: string) {
    setAppointments((current) => current.map((appointment) => appointment.id === id ? { ...appointment, kiosk: "Kiosk 06", status: "Ready", issue: undefined } : appointment));
    setSelectedDrawer(null);
    notify("Device reassigned. Kiosk 06 is now reserved.", "success");
  }

  function openDrawer(payload: DrawerPayload) {
    if (payload.kind === "activity" && payload.relatedId.startsWith("SV-")) {
      const appointment = appointments.find((item) => item.id === payload.relatedId);
      if (appointment) {
        setSelectedDrawer({ kind: "appointment", appointment });
        return;
      }
    }
    setSelectedDrawer(payload);
  }

  function navigate(nextPage: string, nextMode = mode) {
    setMode(nextMode);
    setPage(nextPage);
    setSelectedAppointment(null);
    setSelectedDrawer(null);
    setPopover(null);
    window.history.replaceState(null, "", `/?workspace=${nextMode}&page=${encodeURIComponent(nextPage)}`);
  }

  const currentNav = mode === "operations" ? operationsNav : managementNav;
  const pageContent = mode === "operations" ? renderOperationsPage() : renderManagementPage();

  function renderOperationsPage() {
    if (page === "Appointments") return <AppointmentsPage appointments={appointments} onSelect={setSelectedAppointment} onNotify={notify} />;
    if (page === "Waiting Room") return <WaitingRoomPage appointments={appointments} facilityState={facilityState} onUpdateAppointment={updateAppointment} onNotify={notify} />;
    if (page === "Live Sessions") return <LiveSessionsPage appointments={appointments} onUpdateAppointment={updateAppointment} onNotify={notify} />;
    if (page === "Resources") return <ResourcesPage onNotify={notify} onReassign={reassignAppointment} />;
    if (page === "Incidents") return <IncidentsPage selected={selectedIncident} onSelect={setSelectedIncident} onNotify={notify} />;
    return <CommandCenterPage appointments={appointments} facilityState={facilityState} simulationPaused={simulationPaused} simulationTick={simulationTick} onFacilityStateChange={changeFacilityState} onPause={() => setSimulationPaused((current) => !current)} onAdvance={() => { setSimulationTick((current) => current + 1); notify("Simulation advanced. The operational feed has been refreshed.", "info"); }} onNavigate={navigate} onOpenDrawer={openDrawer} onOpenAppointment={setSelectedAppointment} onOpenPopover={(kind) => setPopover((current) => current === kind ? null : kind)} onNotify={notify} popover={popover} />;
  }

  function renderManagementPage() {
    if (page === "People") return <PeoplePage onNotify={notify} />;
    if (page === "Visitation") return <VisitationPage onNotify={notify} />;
    if (page === "Finance") return <FinancePage onNotify={notify} />;
    if (page === "Compliance") return <CompliancePage onNotify={notify} />;
    if (page === "Facility") return <FacilityPage facilityState={facilityState} onNotify={notify} />;
    return <AdministrationPage onNotify={notify} />;
  }

  return <div className="sv3-app sv6-control-app">
    <aside className="sv3-sidebar">
      <div className="sv3-brand"><SecureVisitLogo /></div>
      <div className="sv3-facility-chip"><span className="sv3-facility-icon">▣</span><div><strong>Central Facility</strong><small>Jakarta · Demo environment</small></div><span>⌄</span></div>
      <div className="sv3-mode-switch" role="tablist" aria-label="Staff workspace"><button className={mode === "operations" ? "active" : ""} onClick={() => navigate("Command Center", "operations")}>Operations</button><button className={mode === "management" ? "active" : ""} onClick={() => navigate("People", "management")}>Management</button></div>
      <SectionLabel>{mode === "operations" ? "Live operations" : "Records & policy"}</SectionLabel>
      <nav className="sv3-nav" aria-label={`${mode} navigation`}>{currentNav.map(([label, icon]) => <button key={label} className={page === label ? "active" : ""} onClick={() => navigate(label)}><span>{icon}</span><b>{label}</b>{label === "Appointments" ? <em>12</em> : label === "Waiting Room" ? <em>3</em> : label === "Incidents" ? <em className="alert">3</em> : null}</button>)}</nav>
      <div className="sv3-sidebar-foot"><div className="sv3-connection"><span className={backendStatus === "connected" ? "online" : "demo"} />{backendStatus === "connected" ? "Protected API connected" : "Demo data · API ready"}</div><button className="sv3-user"><Avatar initials="MS" tone="orange" /><span><strong>Maya Santoso</strong><small>Demo Role · Supervisor</small></span><span>···</span></button></div>
    </aside>
    <main className="sv3-main">
      <div className="sv3-topbar"><div className="sv3-breadcrumb"><span>SecureVisit Control</span><i>/</i><strong>{mode === "operations" ? "Operations" : "Management"}</strong><i>/</i><strong>{page}</strong></div><div className="sv3-top-actions"><button type="button" className="sv3-demo-badge" onClick={() => setPopover(popover === "demo" ? null : "demo")}><i />DEMO ENVIRONMENT</button><span className="sv3-clock">13 Aug 2026 · 09:42 WIB</span><button className="sv3-icon-button" aria-label="Open command palette" onClick={() => setCommandOpen(true)}>⌕</button><button className="sv3-visitor-link" aria-label="Open Visitor Portal" onClick={() => { window.location.href = "/visitor"; }}><span>↗</span> Visitor Portal</button><button className="sv3-icon-button" aria-label="Notifications" onClick={() => notify("No new security notifications.")}>◔</button></div></div>
      <div className="sv3-page-scroll">{pageContent}</div>
    </main>
    {popover === "demo" ? <div className="sv3-top-popover"><span className="sv3-eyebrow">Demo environment</span><strong>Synthetic facility data only</strong><span>Scenario · Normal day</span><span>Simulation · {simulationPaused ? "Paused" : "Running"}</span><Button variant="quiet" onClick={() => { setPopover(null); notify("Demo data reset to the current facility snapshot."); }}>Reset demo data</Button></div> : null}
    <div className="sv3-toasts" aria-live="polite">{notices.map((notice) => <div key={notice.id} className={`sv3-toast sv3-toast-${notice.tone || "info"}`} role="status"><i>{notice.tone === "error" ? "×" : notice.tone === "warning" ? "!" : notice.tone === "success" ? "✓" : "•"}</i><span>{notice.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}>×</button></div>)}</div>
    {selectedAppointment ? <AppointmentDrawer appointment={selectedAppointment} onClose={() => setSelectedAppointment(null)} onRequestApproval={() => setApprovalAppointment(selectedAppointment)} onUpdate={updateAppointment} /> : null}
    {selectedDrawer ? <ContextDrawer payload={selectedDrawer} onClose={() => setSelectedDrawer(null)} onOpenAppointment={(appointment) => { setSelectedDrawer(null); setSelectedAppointment(appointment); }} onRequestApproval={(appointment) => { setSelectedDrawer(null); setApprovalAppointment(appointment); }} onReassign={reassignAppointment} onNotify={notify} /> : null}
    {approvalAppointment ? <ImpactDialog appointment={approvalAppointment} onClose={() => setApprovalAppointment(null)} onConfirm={() => updateAppointment(approvalAppointment.id, "Approved")} /> : null}
    {commandOpen ? <CommandPalette appointments={appointments} onClose={() => setCommandOpen(false)} onOpenAppointment={(appointment) => { setCommandOpen(false); setSelectedAppointment(appointment); }} onOpenDrawer={setSelectedDrawer} onNavigate={(nextPage) => { setCommandOpen(false); navigate(nextPage); }} /> : null}
  </div>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyCommandCenterPage({ appointments, facilityState, simulationPaused, simulationTick, onFacilityStateChange, onPause, onAdvance, onNavigate }: { appointments: Appointment[]; facilityState: string; simulationPaused: boolean; simulationTick: number; onFacilityStateChange: (state: string) => void; onPause: () => void; onAdvance: () => void; onNavigate: (page: string) => void }) {
  const live = appointments.filter((appointment) => appointment.status === "Live").length;
  const waiting = appointments.filter((appointment) => appointment.status === "Ready").length + 2;
  const attention = appointments.filter((appointment) => appointment.status === "Requires action" || appointment.status === "Blocked").length + (facilityState === "LOCKDOWN" ? 1 : 0);
  return <>
    <div className="sv3-command-band"><div><span className="sv3-eyebrow">Central Correctional Facility · Operations</span><h1>{facilityState === "LOCKDOWN" ? "Facility lockdown" : "Command Center"}</h1><p>{facilityState === "LOCKDOWN" ? "New visit approvals are suspended while the facility response is active." : "A live view of what is happening, what is blocked, and what needs a decision."}</p></div><div className="sv3-command-state"><Status tone={facilityState === "LOCKDOWN" ? "red" : "green"}>{facilityState === "LOCKDOWN" ? "LOCKDOWN" : "NORMAL OPERATIONS"}</Status><strong>09:42</strong><small>WIB · Wednesday 13 Aug 2026</small></div></div>
    <div className="sv3-command-metrics"><Metric label="Live sessions" value={String(live)} detail="1 needs monitoring" tone="orange" /><Metric label="Waiting room" value={String(waiting)} detail="2 ready to admit" tone="blue" /><Metric label="Requires attention" value={String(attention)} detail="2 SLA exceptions" tone="red" /><Metric label="Rooms in use" value="4 / 6" detail="67% capacity" tone="green" /></div>
    <div className="sv3-simulation-bar"><span><i className={simulationPaused ? "paused" : ""} />DEMO SIMULATION · {simulationPaused ? "PAUSED" : "RUNNING"} · SPEED 1×</span><div><button onClick={onPause}>{simulationPaused ? "Resume" : "Pause"}</button><button onClick={onAdvance}>Advance event</button><button onClick={() => onFacilityStateChange(facilityState === "LOCKDOWN" ? "NORMAL_OPERATIONS" : "LOCKDOWN")} className="danger-link">{facilityState === "LOCKDOWN" ? "Restore facility" : "Test lockdown"}</button></div><small>Event {String(3 + simulationTick).padStart(2, "0")} · {simulationTick ? "Scenario changed locally" : "Normal day scenario"}</small></div>
    <div className="sv3-command-layout"><section className="sv3-surface sv3-timeline-surface"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Today’s operational timeline</span><h2>Morning visitation</h2></div><button className="sv3-link-button" onClick={() => onNavigate("Appointments")}>Open appointments →</button></div><div className="sv3-timeline"><div className="sv3-timeline-row"><time>09:00</time><span className="sv3-timeline-line done" /><div><Status tone="green">COMPLETED</Status><strong>Sarah Amelia ↔ A. Rahman</strong><small>Room 02 · Family visit · credit settled</small></div></div><div className="sv3-timeline-row"><time>10:00</time><span className="sv3-timeline-line live" /><div><Status tone="orange">LIVE · 11:43 REMAINING</Status><strong>Sarah Amelia ↔ A. Rahman</strong><small>Room 03 · Kiosk 04 · connection stable</small></div></div><div className="sv3-timeline-row"><time>10:20</time><span className="sv3-timeline-line ready" /><div><Status tone="blue">READY</Status><strong>Daniel Wijaya ↔ R. Santoso</strong><small>Room 01 · Identity and device checks complete</small></div></div><div className="sv3-timeline-row"><time>10:40</time><span className="sv3-timeline-line blocked" /><div><Status tone="red">BLOCKED</Status><strong>Alya Pratama ↔ F. Pratama</strong><small>Room 04 · Relationship evidence needs review</small></div></div></div></section><aside className="sv3-attention-rail"><div className="sv3-surface sv3-attention-surface"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Action center</span><h2>Requires attention</h2></div><span className="sv3-count-badge">{attention}</span></div><button className="sv3-action-row" onClick={() => onNavigate("Appointments")}><span className="sv3-action-icon amber">!</span><span><strong>2 approval SLAs exceeded</strong><small>Review before 10:40</small></span><b>›</b></button><button className="sv3-action-row" onClick={() => onNavigate("Resources")}><span className="sv3-action-icon red">×</span><span><strong>Kiosk 04 offline</strong><small>Affects SV-260813-031</small></span><b>›</b></button><button className="sv3-action-row" onClick={() => onNavigate("Waiting Room")}><span className="sv3-action-icon blue">◌</span><span><strong>Visitor waiting 4:32</strong><small>Prisoner not confirmed</small></span><b>›</b></button><button className="sv3-action-row" onClick={() => onNavigate("Incidents")}><span className="sv3-action-icon violet">≡</span><span><strong>Incident needs assignment</strong><small>Unauthorized participant report</small></span><b>›</b></button></div><div className="sv3-surface sv3-feed-surface"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Activity feed</span><h2>What changed</h2></div></div>{activities.map(([time, event, source]) => <div className="sv3-feed-row" key={time}><time>{time}</time><span><strong>{event}</strong><small>{source}</small></span></div>)}</div></aside></div>
  </>;
}

function CommandCenterPage({ appointments, facilityState, simulationPaused, simulationTick, onFacilityStateChange, onPause, onAdvance, onNavigate, onOpenDrawer, onOpenAppointment, onOpenPopover, onNotify, popover }: { appointments: Appointment[]; facilityState: string; simulationPaused: boolean; simulationTick: number; onFacilityStateChange: (state: string) => void; onPause: () => void; onAdvance: () => void; onNavigate: (page: string) => void; onOpenDrawer: (payload: DrawerPayload) => void; onOpenAppointment: (appointment: Appointment) => void; onOpenPopover: (kind: Exclude<PopoverKind, null>) => void; onNotify: (message: string, tone?: Notice["tone"]) => void; popover: PopoverKind }) {
  const lockdown = facilityState === "LOCKDOWN";
  const [lockdownDialog, setLockdownDialog] = useState(false);
  const [propagating, setPropagating] = useState(false);
  const [scenario, setScenario] = useState("Normal day");
  const live = lockdown ? 0 : appointments.filter((appointment) => appointment.status === "Live").length;
  const waiting = lockdown ? 0 : appointments.filter((appointment) => appointment.status === "Ready").length + 2;
  const attention = appointments.filter((appointment) => appointment.status === "Requires action" || appointment.status === "Blocked").length + (lockdown ? 1 : 0);
  const affected = appointments.find((appointment) => appointment.id === "SV-260813-031") || appointments[0];
  const nextDecision = appointments.find((appointment) => appointment.status === "Requires action") || appointments.find((appointment) => appointment.status === "Ready") || appointments[2];
  const timeline = [
    { time: "09:00", status: "COMPLETED", tone: "green", line: "done", title: "Sarah Amelia ↔ A. Rahman", meta: "Room 02 · Family visit · credit settled", action: "View details" },
    { time: "10:00", status: lockdown ? "BLOCKED" : "LIVE · 11:43 REMAINING", tone: lockdown ? "red" : "orange", line: lockdown ? "blocked" : "live", title: "Sarah Amelia ↔ A. Rahman", meta: lockdown ? "Cancelled by facility lockdown · credit released" : "Room 03 · Kiosk 04 · connection stable", appointment: affected, action: lockdown ? "Review" : "Monitor" },
    { time: "10:20", status: lockdown ? "BLOCKED" : "READY", tone: lockdown ? "red" : "blue", line: lockdown ? "blocked" : "ready", title: "Daniel Wijaya ↔ R. Santoso", meta: lockdown ? "Cancelled by facility lockdown · unit notified" : "Room 01 · Identity and device checks complete", appointment: appointments[1], action: lockdown ? "Review" : "Admit" },
    { time: "10:40", status: "BLOCKED", tone: "red", line: "blocked", title: "Alya Pratama ↔ F. Pratama", meta: lockdown ? "Cancelled by facility lockdown · review suspended" : "Room 04 · Relationship evidence needs review", appointment: nextDecision, action: "Resolve" },
  ];

  function confirmLockdown() {
    setLockdownDialog(false);
    setPropagating(true);
    onFacilityStateChange("LOCKDOWN");
    onNotify("Facility response propagating across visits, rooms, and kiosks.", "warning");
    window.setTimeout(() => { setPropagating(false); onNotify("Lockdown active. Affected visits and released resources are now visible.", "warning"); }, 1300);
  }

  function handleScenario(value: string) {
    setScenario(value);
    if (value === "Facility lockdown") {
      setLockdownDialog(true);
      return;
    }
    onNotify(`${value} scenario loaded. Operational data remains scoped to the demo facility.`, "info");
  }

  return <>
    <div className={`sv3-command-band sv6-command-hero ${lockdown ? "sv3-command-band-lockdown" : ""} ${propagating ? "sv3-state-propagating" : ""}`}><div><span className="sv3-eyebrow">Central Correctional Facility · Operations</span><h1>{lockdown ? "Facility lockdown" : "Command Center"}</h1><p>{lockdown ? "New visit approvals are suspended while the facility response is active." : "Live operations across today&apos;s visitation program."}</p><div className="sv6-hero-meta"><span><i className="sv6-pulse-dot" />{backendStatusLabel(lockdown)}</span><span>Last sync <b>09:42:06</b></span></div></div><div className="sv3-command-state"><Status tone={lockdown ? "red" : "green"}>{lockdown ? "FACILITY LOCKDOWN" : "NORMAL OPERATIONS"}</Status><strong>09:42</strong><small>WIB · Wednesday 13 Aug 2026</small></div></div>
    {lockdown ? <div className="sv3-lockdown-strip"><strong>Operational response active</strong><span>Approvals suspended · 23 upcoming visits affected · 6 rooms released · 5 kiosks released</span></div> : null}
    <div className="sv3-command-metrics sv6-command-metrics"><Metric label="Live sessions" value={String(live)} detail={lockdown ? "Sessions ended by response" : "1 needs monitoring"} tone="orange" onClick={() => onOpenPopover("session")} /><Metric label="Waiting room" value={String(waiting)} detail={lockdown ? "Waiting room closed" : "2 ready to admit"} tone="blue" onClick={() => onOpenPopover("waiting")} /><Metric label="Requires attention" value={String(attention)} detail={lockdown ? "1 response event" : "2 SLA exceptions"} tone="red" onClick={() => document.querySelector(".sv3-attention-surface")?.scrollIntoView({ behavior: "smooth", block: "center" })} /><Metric label="Rooms in use" value={lockdown ? "6 / 6" : "4 / 6"} detail={lockdown ? "All rooms released" : "67% capacity"} tone="green" onClick={() => onOpenPopover("capacity")} />{popover === "session" ? <SessionPopover onOpen={() => onOpenDrawer({ kind: "activity", event: "Sarah Amelia ↔ A. Rahman", source: "Live session", relatedId: "SV-260813-031" })} /> : popover === "waiting" ? <WaitingPopover onOpen={() => onOpenDrawer({ kind: "waiting", visitor: "Sarah Amelia" })} /> : popover === "capacity" ? <CapacityPopover onOpen={() => onNavigate("Resources")} /> : null}</div>
    <div className="sv3-simulation-bar sv6-simulation-bar"><div className="sv6-simulation-status"><span><i className={simulationPaused ? "paused" : ""} />Demo simulation</span><strong>{simulationPaused ? "Paused" : "Running"}</strong></div><label className="sv6-simulation-field">Scenario<select value={scenario} onChange={(event) => handleScenario(event.target.value)}><option>Normal day</option><option>Busy morning</option><option>Device failure</option><option>Visitor no-show</option><option>Facility lockdown</option><option>Technical failure</option><option>Security incident</option></select></label><span className="sv6-simulation-speed">Speed <b>1×</b></span><div className="sv6-simulation-actions"><button onClick={onPause}>{simulationPaused ? "Resume" : "Pause"}</button><button onClick={onAdvance}>Advance event</button><button onClick={() => onNotify("Scenario library is available in the demo environment.")}>Scenarios</button><button onClick={() => lockdown ? onFacilityStateChange("NORMAL_OPERATIONS") : setLockdownDialog(true)} className="danger-link">{lockdown ? "Restore facility" : "Test lockdown"}</button></div><small>Event {String(3 + simulationTick).padStart(2, "0")} · {simulationTick ? "Local event propagated" : "Normal day scenario"}</small></div>
    <div className="sv6-operations-label"><div><span className="sv3-eyebrow">Decision surface</span><strong>Act on the next operational moment</strong></div><span>4 records · sorted by time and urgency</span></div>
    <div className="sv3-command-layout"><section className="sv3-surface sv3-timeline-surface sv6-timeline-surface"><div className="sv3-surface-head"><div><span className="sv3-eyebrow" aria-label="Today&apos;s operational timeline">Today · Wednesday 13 August</span><h2>Morning operations</h2></div><button className="sv3-link-button" onClick={() => onNavigate("Appointments")}>Open appointments →</button></div><div className="sv3-timeline">{timeline.map((item) => <div className={`sv3-timeline-row sv3-timeline-row-interactive ${item.status === "BLOCKED" ? "timeline-blocked" : ""}`} key={item.time} role="button" tabIndex={0} onClick={() => item.appointment && onOpenAppointment(item.appointment)} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && item.appointment) { event.preventDefault(); onOpenAppointment(item.appointment); } }}><time>{item.time}</time><span className={`sv3-timeline-line ${item.line}`} /><div className="sv6-timeline-content"><div className="sv6-timeline-topline"><button type="button" className="sv3-timeline-status" onClick={(event) => { event.stopPropagation(); if (item.appointment) onOpenDrawer({ kind: item.status.includes("LIVE") ? "activity" : "appointment", ...(item.status.includes("LIVE") ? { event: "Sarah Amelia ↔ A. Rahman", source: "Live session", relatedId: item.appointment.id } : { appointment: item.appointment }) }); }}><Status tone={item.tone}>{item.status}</Status></button><button type="button" className="sv6-row-action" onClick={(event) => { event.stopPropagation(); if (item.appointment) onOpenAppointment(item.appointment); }}>{item.action} <span>→</span></button></div><strong>{item.title.includes("Sarah") ? <PersonHoverCard name="Sarah Amelia" detail="Verified · Sister of A. Rahman" onOpen={() => onOpenDrawer({ kind: "waiting", visitor: "Sarah Amelia" })}>Sarah Amelia</PersonHoverCard> : item.title.split(" ↔ ")[0]} {item.title.includes("↔") ? `↔ ${item.title.split(" ↔ ")[1]}` : ""}</strong><small>{item.meta}</small></div></div>)}</div></section><aside className="sv3-attention-rail"><div className="sv3-surface sv3-attention-surface sv6-attention-surface" id="action-center"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Priority queue</span><h2>Requires attention</h2></div><span className="sv3-count-badge">{attention}</span></div><button className="sv3-action-row" onClick={() => onOpenAppointment(nextDecision)}><span className="sv3-action-icon amber">!</span><span><strong>2 approval SLAs exceeded</strong><small>Oldest request 42 min · 2 visitors affected</small></span><b>›</b><em>Review queue</em></button><button className="sv3-action-row" onClick={() => onOpenDrawer({ kind: "device", device: "Kiosk 04" })}><span className="sv3-action-icon red">×</span><span><strong>Kiosk 04 offline</strong><small>Affects SV-260813-031 · heartbeat 4 min ago</small></span><b>›</b><em>Reassign</em></button><button className="sv3-action-row" onClick={() => onOpenDrawer({ kind: "waiting", visitor: "Sarah Amelia" })}><span className="sv3-action-icon blue">◌</span><span><strong>Visitor waiting 4:32</strong><small>Sarah Amelia · prisoner not confirmed</small></span><b>›</b><em>Check readiness</em></button><button className="sv3-action-row" onClick={() => onOpenDrawer({ kind: "incident", id: "INC-260813-019" })}><span className="sv3-action-icon violet">≡</span><span><strong>Incident needs assignment</strong><small>Unauthorized participant report · Medium severity</small></span><b>›</b><em>Assign</em></button></div><div className="sv3-surface sv3-feed-surface sv6-feed-surface"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Activity · live history</span><h2>What changed</h2></div><span className="sv6-feed-live"><i />Live</span></div>{activities.map(([time, event, source]) => <button className="sv3-feed-row sv3-feed-row-interactive" key={time} onClick={() => onOpenDrawer({ kind: "activity", event, source, relatedId: event.includes("SV-") ? "SV-260813-033" : event.includes("Kiosk") ? "Kiosk 04" : "SV-260813-031" })}><time>{time}</time><span><strong>{event}</strong><small>{source} · View event</small></span><b>›</b></button>)}</div></aside></div>
    {lockdownDialog ? <AlertDialog title="Declare facility lockdown" description="This action affects every scheduled visit and releases reserved resources across Central Correctional Facility." stats={["23 upcoming visits affected", "6 visitors currently waiting", "18 visit credits released", "4 rooms and 5 kiosks released"]} onCancel={() => setLockdownDialog(false)} onConfirm={confirmLockdown} /> : null}
  </>;
}

function backendStatusLabel(lockdown: boolean) {
  return lockdown ? "Response in progress" : "All systems reporting";
}

function AppointmentsPage({ appointments, onSelect, onNotify }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [view, setView] = useState("Queue");
  const [filter, setFilter] = useState("Needs decision");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [typeFilter, setTypeFilter] = useState("All types");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = appointments.filter((appointment) => appointment.status !== "Completed");
  const needsDecision = active.filter((appointment) => ["Requires action", "Ready"].includes(appointment.status));
  const blocked = active.filter((appointment) => appointment.status === "Blocked");
  const ready = active.filter((appointment) => appointment.status === "Ready");
  const slaRisk = active.filter((appointment) => ["Requires action", "Blocked"].includes(appointment.status));
  const quickFilters = ["Needs decision", "Blocked", "SLA risk", "Information requested", "New time proposed", "All active"];
  const filterRows = filter === "Needs decision" ? needsDecision : filter === "Blocked" ? blocked : filter === "SLA risk" ? slaRisk : filter === "Information requested" ? [] : filter === "New time proposed" ? [] : active;
  const filtered = filterRows.filter((appointment) => `${appointment.visitor} ${appointment.prisoner} ${appointment.id} ${appointment.issue || ""}`.toLowerCase().includes(query.toLowerCase())).filter((appointment) => statusFilter === "All statuses" || appointment.status === statusFilter).filter((appointment) => typeFilter === "All types" || appointment.type === typeFilter);
  const statusLabel = (status: AppointmentStatus) => status === "Requires action" ? "Needs review" : status === "Ready" ? "Ready to approve" : status;
  const tone = (status: AppointmentStatus) => status === "Blocked" ? "red" : status === "Requires action" ? "orange" : status === "Live" ? "green" : "blue";
  const open = (appointment: Appointment) => { setSelectedId(appointment.id); onSelect(appointment); };
  const changeView = (nextView: string) => { setView(nextView); window.history.replaceState(null, "", `/?workspace=operations&page=Appointments&view=${nextView.toLowerCase()}`); };
  // Queue rows retain button semantics for keyboard selection while participating in the shared list layout.
  // eslint-disable-next-line jsx-a11y/role-supports-aria-props
  return <div className="sv7-appointments-page"><PageHeader eyebrow="Operations · Appointments" title="Appointments" description="Review visit requests, resolve blockers, and move approved visits into the operational schedule." actions={<><Button onClick={() => onNotify("Create appointment flow opened. Visitor, connection, time, and review are required.")}>+ Create appointment</Button><Button variant="primary" onClick={() => open(needsDecision[0] || active[0])} disabled={!active.length}>Review next decision</Button></>} /><div className="sv7-appointment-summary"><button className={filter === "Needs decision" ? "active" : ""} onClick={() => setFilter("Needs decision")}><b>{needsDecision.length}</b><span>Needs review</span></button><i /><button className={filter === "Blocked" ? "active" : ""} onClick={() => setFilter("Blocked")}><b>{blocked.length}</b><span>Blocked</span></button><i /><button className={filter === "SLA risk" ? "active" : ""} onClick={() => setFilter("SLA risk")}><b>{slaRisk.length}</b><span>SLA risk</span></button><i /><button className={filter === "All active" ? "active" : ""} onClick={() => setFilter("All active")}><b>{ready.length}</b><span>Ready to approve</span></button></div><div className="sv3-workspace-tabs sv7-appointment-tabs"><button className={view === "Queue" ? "active" : ""} onClick={() => changeView("Queue")}>Queue <em>{needsDecision.length}</em></button><button className={view === "Timeline" ? "active" : ""} onClick={() => changeView("Timeline")}>Timeline <em>{active.length}</em></button><button className={view === "Calendar" ? "active" : ""} onClick={() => changeView("Calendar")}>Calendar</button></div>{view === "Queue" ? <section className="sv7-queue-surface"><div className="sv7-queue-toolbar"><div className="sv7-queue-search"><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visitor, prisoner, visit ID, or reference" /></label><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option><option>Requires action</option><option>Ready</option><option>Blocked</option><option>Approved</option></select><select aria-label="Filter by visit type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All types</option><option>Family</option><option>Legal</option></select></div><div className="sv7-queue-meta"><span>{filtered.length} active requests</span><button onClick={() => { setQuery(""); setStatusFilter("All statuses"); setTypeFilter("All types"); setFilter("All active"); }}>Clear filters</button></div></div><div className="sv7-quick-filters">{quickFilters.map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}{["Needs decision", "Blocked", "SLA risk"].includes(item) ? <em>{item === "Needs decision" ? needsDecision.length : item === "Blocked" ? blocked.length : slaRisk.length}</em> : null}</button>)}</div><div className="sv7-active-chips">{filter !== "All active" ? <span>{filter} <button onClick={() => setFilter("All active")} aria-label={`Clear ${filter} filter`}>×</button></span> : null}{statusFilter !== "All statuses" ? <span>{statusLabel(statusFilter as AppointmentStatus)} <button onClick={() => setStatusFilter("All statuses")} aria-label="Clear status filter">×</button></span> : null}{typeFilter !== "All types" ? <span>{typeFilter} visit <button onClick={() => setTypeFilter("All types")} aria-label="Clear visit type filter">×</button></span> : null}</div>{filtered.length ? <div className="sv7-queue-list" role="list"><div className="sv7-queue-head" aria-hidden="true"><span>Request</span><span>Participants</span><span>Requested time</span><span>Readiness</span><span>SLA</span><span>Status</span><span>Action</span></div>{filtered.map((appointment) => <button role="listitem" className={`sv7-queue-row ${selectedId === appointment.id ? "selected" : ""}`} aria-pressed={selectedId === appointment.id} key={appointment.id} onClick={() => open(appointment)}><span className="sv7-request-cell"><strong>{appointment.type} Visit</strong><small>{appointment.id}</small></span><span className="sv7-participant-cell"><strong>{appointment.visitor} <i>↔</i> {appointment.prisoner}</strong><small>{appointment.issue ? "Connection review required" : "Approved connection"}</small></span><span className="sv7-time-cell"><strong>{appointment.date}</strong><small>{appointment.time} WIB</small></span><span className={`sv7-readiness-cell ${appointment.issue ? "warning" : appointment.status === "Blocked" ? "blocked" : "ready"}`}><strong>{appointment.status === "Blocked" ? "× 4 / 6 ready" : appointment.issue ? "! 5 / 6 ready" : "✓ 6 / 6 ready"}</strong><small>{appointment.issue || "All required checks passed"}</small></span><span className={`sv7-sla-cell ${appointment.status === "Requires action" || appointment.status === "Blocked" ? "risk" : ""}`}>{appointment.status === "Blocked" ? "12 min overdue" : appointment.status === "Requires action" ? "6 min remaining" : "18 min remaining"}</span><span><Status tone={tone(appointment.status)}>{statusLabel(appointment.status)}</Status></span><span className="sv7-row-action">{appointment.status === "Blocked" ? "Resolve" : appointment.status === "Requires action" ? "Review" : appointment.status === "Ready" ? "Review" : "View"} <b>→</b></span></button>)}</div> : <div className="sv7-empty-queue"><strong>All caught up</strong><p>There are no visit requests matching this decision filter.</p><Button onClick={() => { setFilter("All active"); setQuery(""); }}>View all active</Button></div>}<div className="sv7-queue-footer"><span>Sorted by SLA risk, blockers, and readiness</span><span>SecureVisit decision queue · demo facility</span></div></section> : view === "Timeline" ? <TimelineView appointments={active} onSelect={open} /> : <CalendarView appointments={active} onSelect={open} onNotify={onNotify} />}</div>;
}

function TimelineView({ appointments, onSelect }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void }) {
  const [timelineFilter, setTimelineFilter] = useState("All");
  const filtered = timelineFilter === "All" ? appointments : appointments.filter((appointment) => timelineFilter === "Live" ? appointment.status === "Live" : timelineFilter === "Blocked" ? appointment.status === "Blocked" : timelineFilter === "Approved" ? ["Approved", "Ready"].includes(appointment.status) : appointment.status === "Completed");
  return <section className="sv7-timeline-surface"><div className="sv7-view-header"><div><span className="sv3-eyebrow">Today · Wednesday 13 August</span><h2>Operational timeline</h2><p>{appointments.length} visits · {appointments.filter((appointment) => appointment.status === "Blocked").length} blocked · 4 rooms in use</p></div><div className="sv7-view-controls"><Button onClick={() => undefined}>‹ Previous day</Button><Button onClick={() => undefined}>Today</Button><Button onClick={() => undefined}>Next day ›</Button></div></div><div className="sv7-timeline-filters">{["All", "Approved", "Blocked", "Live", "Completed"].map((item) => <button className={timelineFilter === item ? "active" : ""} key={item} onClick={() => setTimelineFilter(item)}>{item}</button>)}</div><div className="sv7-vertical-timeline">{filtered.map((appointment, index) => <button className={`sv7-timeline-event ${appointment.status === "Completed" ? "completed" : ""}`} key={appointment.id} onClick={() => onSelect(appointment)}><time>{["09:00", "10:00", "10:20", "10:40", "11:20"][index] || "12:00"}</time><span className={`sv7-timeline-node ${appointment.status === "Blocked" ? "blocked" : appointment.status === "Live" ? "live" : "ready"}`} /><span className="sv7-timeline-event-body"><span><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "blue"}>{appointment.status === "Requires action" ? "NEEDS REVIEW" : appointment.status.toUpperCase()}</Status><em>{appointment.room} · {appointment.kiosk}</em></span><strong>{appointment.visitor} ↔ {appointment.prisoner}</strong><small>{appointment.type} Visit · {appointment.issue || "All required checks passed"}</small></span><b>›</b></button>)}</div></section>;
}

function CalendarView({ appointments, onSelect, onNotify }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const days = ["27", "28", "29", "30", "31", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30"];
  return <section className="sv7-calendar-surface"><div className="sv7-view-header"><div><span className="sv3-eyebrow">Planning horizon · August 2026</span><h2>Schedule calendar</h2><p>Week overview for capacity planning. Select a visit to open its decision record.</p></div><div className="sv7-calendar-summary"><strong>{appointments.length + 13}</strong><span>scheduled visits<br />72% capacity</span></div></div><div className="sv7-calendar-grid">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span className="sv7-calendar-weekday" key={day}>{day}</span>)}{days.map((day, index) => <div className={`sv7-calendar-cell ${day === "13" ? "today" : ""} ${index < 5 ? "muted" : ""}`} key={`${day}-${index}`}><b>{day}</b>{day === "13" ? <><button className="sv7-calendar-event approved" onClick={() => onSelect(appointments[0])}>10:00 Sarah · Approved</button><button className="sv7-calendar-event blocked" onClick={() => onSelect(appointments[2])}>10:40 Alya · Review</button></> : day === "14" ? <button className="sv7-calendar-event pending" onClick={() => onNotify("Thursday has 4 scheduled visits and one available room.")}>4 visits · 58%</button> : null}</div>)}</div><div className="sv7-calendar-footer"><span><i className="approved" />Approved</span><span><i className="pending" />Pending</span><span><i className="blocked" />Blocked</span><Button onClick={() => onNotify("Day plan opened with 18 appointments, 4 rooms, and 6 kiosks.")}>Open day plan →</Button></div></section>;
}

function buildWaitingChecks(appointment: Appointment, state: WaitingState, facilityState: string): ReadinessCheck[] {
  const notArrived = state === "NOT_ARRIVED";
  const technical = state === "TECHNICAL_ISSUE";
  const review = state === "STAFF_REVIEW";
  const facilityBlocked = facilityState !== "NORMAL_OPERATIONS";
  return [
    { key: "visitor", label: "Visitor present", detail: notArrived ? "Not checked in" : "Visitor is in the waiting room", state: notArrived ? "pending" : "pass" },
    { key: "prisoner", label: "Prisoner present", detail: notArrived ? "Unit confirmation pending" : review ? "Unit confirmation required" : "Prisoner is ready", state: notArrived || review ? "pending" : "pass" },
    { key: "identity", label: "Identity/session verified", detail: review ? "Relationship evidence needs review" : notArrived ? "Runs at check-in" : "Verified for this visit", state: review ? "warning" : notArrived ? "pending" : "pass" },
    { key: "camera", label: "Camera working", detail: technical ? "Camera test needs retry" : notArrived ? "Runs at check-in" : "Camera signal healthy", state: technical ? "failed" : notArrived ? "pending" : "pass" },
    { key: "microphone", label: "Microphone working", detail: technical ? "Microphone unavailable on assigned kiosk" : notArrived ? "Runs at check-in" : "Microphone signal healthy", state: technical ? "failed" : notArrived ? "pending" : "pass" },
    { key: "network", label: "Network acceptable", detail: technical ? "Connection test failed at 09:38" : notArrived ? "Runs at check-in" : "Stable · 42 ms", state: technical ? "failed" : notArrived ? "pending" : "pass" },
    { key: "room", label: "Room available", detail: facilityBlocked ? "Facility state requires supervisor review" : `${appointment.room} reserved for this window`, state: facilityBlocked ? "warning" : "pass" },
    { key: "kiosk", label: "Kiosk connected", detail: technical ? `${appointment.kiosk} is offline · alternative available` : `${appointment.kiosk} connected`, state: technical ? "failed" : "pass" },
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
  return {
    ...appointment,
    waitingState,
    countdown: waitingState === "READY_TO_START" ? "READY NOW" : waitingState === "NOT_ARRIVED" ? "IN 18 MIN" : waitingState === "LATE" ? "08 MIN LATE" : "04:32 WAIT",
    visitorPresence,
    prisonerPresence,
    verification: checks.find((check) => check.key === "identity")?.state || "pending",
    checks,
    blocker: blocker?.detail,
    lastUpdated: waitingState === "TECHNICAL_ISSUE" ? "Updated 4 min ago" : "Updated just now",
  };
}

function WaitingRoomPage({ appointments, facilityState, onUpdateAppointment, onNotify }: { appointments: Appointment[]; facilityState: string; onUpdateAppointment: (id: string, status: AppointmentStatus) => void; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [lane, setLane] = useState("all");
  const [query, setQuery] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<Record<string, WaitingState>>({});
  const baseRecords = appointments.map((appointment) => buildWaitingRecord(appointment, facilityState, transitions[appointment.id])).filter((record): record is WaitingRecord => Boolean(record));
  const records = baseRecords.filter((record) => `${record.visitor} ${record.prisoner} ${record.id} ${record.room} ${record.kiosk}`.toLowerCase().includes(query.toLowerCase())).filter((record) => !onlyAttention || ["TECHNICAL_ISSUE", "STAFF_REVIEW", "LATE"].includes(record.waitingState));
  const counts = {
    ready: baseRecords.filter((record) => record.waitingState === "READY_TO_START").length,
    waiting: baseRecords.filter((record) => ["VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT"].includes(record.waitingState)).length,
    attention: baseRecords.filter((record) => ["TECHNICAL_ISSUE", "STAFF_REVIEW", "LATE"].includes(record.waitingState)).length,
    upcoming: baseRecords.filter((record) => record.waitingState === "NOT_ARRIVED").length,
  };
  const laneFor = (state: WaitingState) => state === "READY_TO_START" ? "ready" : state === "NOT_ARRIVED" ? "upcoming" : ["TECHNICAL_ISSUE", "STAFF_REVIEW", "LATE"].includes(state) ? "attention" : "waiting";
  const laneRecords = (value: string) => records.filter((record) => value === "all" || laneFor(record.waitingState) === value);
  const selected = baseRecords.find((record) => record.id === selectedId) || null;

  function notifyTransition(record: WaitingRecord, nextState: WaitingState, message: string, tone: Notice["tone"] = "success") {
    setTransitions((current) => ({ ...current, [record.id]: nextState }));
    onNotify(message, tone);
  }

  async function action(record: WaitingRecord, kind: "admit" | "checks" | "contact" | "late" | "reassign" | "cancel" | "start") {
    if (kind === "start") {
      if (!record.checks.every((check) => check.state === "pass") || facilityState !== "NORMAL_OPERATIONS") {
        onNotify("This visit cannot start until every pre-call check passes and the facility is operating normally.", "error");
        return;
      }
      try {
        const response = await fetch("/api/control/waiting-room", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ appointmentId: record.id, command: "start_visit", reason: "Staff started the authorized visit after all pre-call checks passed." }) });
        const body = await response.json() as { error?: string };
        if (!response.ok) throw new Error(body.error === "VIDEO_PROVIDER_NOT_CONFIGURED" ? "LiveKit is not configured for this environment yet. Add the server-side video provider settings before starting a real visit." : body.error || "The session could not be started.");
        notifyTransition(record, "LIVE", `${record.visitor} moved to Live Sessions.`, "success");
        onUpdateAppointment(record.id, "Live");
        setSelectedId(null);
      } catch (error) {
        onNotify(error instanceof Error ? error.message : "The session could not be started.", "error");
      }
      return;
    }
    if (kind === "admit") return notifyTransition(record, "READY_TO_START", `${record.visitor} admitted. Pre-call checks are ready to run.`, "success");
    if (kind === "checks") return notifyTransition(record, "READY_TO_START", `Connection test completed for ${record.visitor}. All required checks passed.`, "success");
    if (kind === "contact") return onNotify(`Secure message sent to the ${record.prisoner} unit about ${record.id}.`, "info");
    if (kind === "late") return notifyTransition(record, "LATE", `${record.visitor} marked late. Staff follow-up is required.`, "warning");
    if (kind === "reassign") return notifyTransition(record, "READY_TO_START", `${record.kiosk} released. ${record.visitor} is ready for the replacement kiosk.`, "success");
    if (kind === "cancel") {
      onUpdateAppointment(record.id, "Blocked");
      notifyTransition(record, "STAFF_REVIEW", `${record.visitor} was held for cancellation review.`, "warning");
    }
  }

  function primaryAction(record: WaitingRecord) {
    if (record.waitingState === "READY_TO_START") return ["start", "Start Visit"] as const;
    if (record.waitingState === "TECHNICAL_ISSUE") return ["checks", "Run connection test"] as const;
    if (record.waitingState === "STAFF_REVIEW") return ["checks", "Review checks"] as const;
    if (record.waitingState === "NOT_ARRIVED" || record.waitingState === "LATE") return ["contact", "Contact visitor"] as const;
    return ["admit", "Admit visitor"] as const;
  }

  return <div className="sv8-waiting-page"><PageHeader eyebrow="Operations · Admission control" title="Waiting Room" description="Move approved appointments from arrival to a safe, verified handoff into Live Sessions." actions={<><Status tone={facilityState === "NORMAL_OPERATIONS" ? "green" : "red"}>{facilityState === "NORMAL_OPERATIONS" ? "ROOM OPEN" : "FACILITY REVIEW"}</Status><Button variant="primary" onClick={() => onNotify("Readiness checks refreshed for the linked appointment queue.", "success")}>↻ Refresh readiness</Button></>} /><div className="sv8-summary"><button onClick={() => setLane("waiting")} className={lane === "waiting" ? "active" : ""}><span>Waiting now</span><strong>{counts.waiting}</strong><small>presence or unit confirmation</small></button><button onClick={() => setLane("ready")} className={lane === "ready" ? "active" : ""}><span>Ready to start</span><strong>{counts.ready}</strong><small>all checks passing</small></button><button onClick={() => setLane("attention")} className={lane === "attention" ? "active" : ""}><span>Needs attention</span><strong>{counts.attention}</strong><small>blockers or late arrivals</small></button><button onClick={() => setLane("upcoming")} className={lane === "upcoming" ? "active" : ""}><span>Upcoming</span><strong>{counts.upcoming}</strong><small>not yet in the window</small></button></div><section className="sv8-queue"><div className="sv8-toolbar"><label className="sv8-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visitor, prisoner, visit ID, room, or kiosk" /></label><label className="sv8-select"><span>Window</span><select aria-label="Waiting room time window"><option>Next 2 hours</option><option>Today</option><option>All approved</option></select></label><button type="button" className={`sv8-attention-toggle ${onlyAttention ? "active" : ""}`} onClick={() => setOnlyAttention((current) => !current)}>Only needs attention</button><span className="sv8-toolbar-meta">{laneRecords(lane).length} linked visits · live readiness</span></div><div className="sv8-lane-tabs"><span>VIEW</span>{[["all", "All visits"], ["ready", "Ready to start"], ["waiting", "Waiting now"], ["attention", "Needs attention"], ["upcoming", "Upcoming"]].map(([value, label]) => <button className={lane === value ? "active" : ""} key={value} onClick={() => setLane(value)}>{label}{value !== "all" ? <em>{counts[value as keyof typeof counts]}</em> : null}</button>)}</div><div className="sv8-lanes">{[["ready", "READY TO START", "green"], ["waiting", "WAITING NOW", "blue"], ["attention", "NEEDS ATTENTION", "orange"], ["upcoming", "UPCOMING", "gray"]].map(([value, label, tone]) => <section className={`sv8-lane sv8-lane-${tone}`} key={value}><header><span><i />{label}</span><strong>{laneRecords(value).length}</strong></header><div className="sv8-lane-body">{laneRecords(value).map((record) => <article className={`sv8-card ${selectedId === record.id ? "selected" : ""}`} key={record.id}><button className="sv8-card-main" onClick={() => setSelectedId(record.id)}><div className="sv8-card-top"><Avatar initials={record.visitorInitials} tone={value === "attention" ? "orange" : value === "upcoming" ? "purple" : "blue"} /><span><strong>{record.visitor}</strong><small>{record.prisoner} · <span className="sv8-mono">{record.id}</span></small></span><Status tone={record.waitingState === "READY_TO_START" ? "green" : record.waitingState === "TECHNICAL_ISSUE" ? "red" : record.waitingState === "STAFF_REVIEW" || record.waitingState === "LATE" ? "orange" : "blue"}>{record.waitingState.replaceAll("_", " ")}</Status></div><div className="sv8-card-time"><strong>{record.date} · {record.time}</strong><span>{record.countdown}</span></div><div className="sv8-card-facts"><span>Visitor <b className={record.visitorPresence === "present" ? "pass" : "pending"}>{record.visitorPresence === "present" ? "Present" : "Not arrived"}</b></span><span>Prisoner <b className={record.prisonerPresence === "present" ? "pass" : "pending"}>{record.prisonerPresence === "present" ? "Present" : "Waiting"}</b></span><span>Resource <b>{record.room} · {record.kiosk}</b></span></div>{record.blocker ? <p className="sv8-blocker"><b>Blocker</b>{record.blocker}</p> : null}</button><div className="sv8-card-actions"><Button variant={primaryAction(record)[0] === "start" ? "primary" : "secondary"} onClick={() => action(record, primaryAction(record)[0])}>{primaryAction(record)[1]}</Button><button type="button" className="sv8-open-link" onClick={() => setSelectedId(record.id)}>Open readiness →</button></div></article>)}{!laneRecords(value).length ? <div className="sv8-lane-empty">No linked visits in this lane.</div> : null}</div></section>)}</div><footer className="sv8-footer"><span>Linked to the approved appointment queue · refreshes every 15 seconds in production.</span><strong>Last sync · just now</strong></footer></section>{selected ? <div className="sv8-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}><aside className="sv8-drawer" role="dialog" aria-modal="true" aria-labelledby="waiting-drawer-title"><header className="sv8-drawer-head"><div><span className="sv8-kicker">{selected.id} · READINESS RECORD</span><h2 id="waiting-drawer-title">{selected.visitor}</h2><p>{selected.prisoner} · {selected.type} visit</p></div><button type="button" aria-label="Close readiness drawer" onClick={() => setSelectedId(null)}>×</button></header><div className="sv8-drawer-scroll"><div className="sv8-drawer-hero"><Avatar initials={selected.visitorInitials} tone="orange" /><div><strong>{selected.date} · {selected.time}</strong><small>{selected.room} · {selected.kiosk}</small></div><Status tone={selected.waitingState === "READY_TO_START" ? "green" : selected.waitingState === "TECHNICAL_ISSUE" ? "red" : "orange"}>{selected.waitingState.replaceAll("_", " ")}</Status></div><div className="sv8-drawer-callout"><span className="sv8-kicker">NEXT DECISION</span><strong>{selected.waitingState === "READY_TO_START" ? "Safe to start" : selected.blocker || "Waiting for arrival and facility confirmation"}</strong><p>{selected.waitingState === "READY_TO_START" ? "All required checks are passing. Starting this visit will hand it to the Live Sessions workspace." : "Resolve the highlighted blocker before starting the visit."}</p></div><section className="sv8-drawer-section"><header><span className="sv8-kicker">PRESENCE</span><span className="sv8-mono">{selected.countdown}</span></header><div className="sv8-presence-grid"><div><span>Visitor</span><strong className={selected.visitorPresence === "present" ? "pass" : "pending"}>{selected.visitorPresence === "present" ? "Present" : "Not arrived"}</strong></div><div><span>Prisoner</span><strong className={selected.prisonerPresence === "present" ? "pass" : "pending"}>{selected.prisonerPresence === "present" ? "Present" : "Waiting"}</strong></div></div></section><section className="sv8-drawer-section"><header><span className="sv8-kicker">PRE-CALL CHECKS</span><span className="sv8-check-score">{selected.checks.filter((check) => check.state === "pass").length}/{selected.checks.length} passing</span></header><div className="sv8-check-list">{selected.checks.map((check) => <div className="sv8-check-row" key={check.key}><span className={`sv8-check-icon ${check.state}`}>{check.state === "pass" ? "✓" : check.state === "failed" ? "×" : check.state === "warning" ? "!" : "·"}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div></section><section className="sv8-drawer-section"><header><span className="sv8-kicker">ASSIGNMENT</span></header><div className="sv8-detail-grid"><span><small>Room</small><strong>{selected.room}</strong></span><span><small>Kiosk</small><strong>{selected.kiosk}</strong></span><span><small>Visit ID</small><strong className="sv8-mono">{selected.id}</strong></span><span><small>Updated</small><strong>{selected.lastUpdated}</strong></span></div></section><section className="sv8-drawer-section"><header><span className="sv8-kicker">STAFF NOTES</span></header><p className="sv8-notes">{selected.issue || "No staff notes. Session is linked to the approved appointment and its reserved resources."}</p></section></div><footer className="sv8-drawer-actions"><Button variant="quiet" onClick={() => action(selected, "cancel")}>Cancel visit</Button>{selected.waitingState !== "READY_TO_START" ? <Button onClick={() => action(selected, "reassign")}>Reassign kiosk</Button> : null}<Button onClick={() => action(selected, "late")}>Mark late</Button><Button variant="primary" onClick={() => action(selected, primaryAction(selected)[0])} disabled={primaryAction(selected)[0] === "start" && selected.checks.some((check) => check.state !== "pass")}>{primaryAction(selected)[1]}</Button></footer></aside></div> : null}</div>;
}

function LiveSessionsPage({ appointments, onUpdateAppointment, onNotify }: { appointments: Appointment[]; onUpdateAppointment: (id: string, status: AppointmentStatus) => void; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [serverSessions, setServerSessions] = useState<Record<string, { id: string; status: string; authorized_end_at: string }>>({});
  const [ending, setEnding] = useState(false);
  const live = appointments.filter((appointment) => appointment.status === "Live");
  const recentlyEnded = appointments.filter((appointment) => appointment.status === "Completed");

  useEffect(() => {
    let active = true;
    fetch("/api/control/live-sessions", { headers: { accept: "application/json" } }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { sessions?: { id: string; appointment_id: string; status: string; authorized_end_at: string }[] };
      if (!active) return;
      setServerSessions(Object.fromEntries((body.sessions || []).map((session) => [session.appointment_id, { id: session.id, status: session.status, authorized_end_at: session.authorized_end_at }])));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function endSession(appointment: Appointment) {
    const persisted = serverSessions[appointment.id];
    if (!persisted) {
      onUpdateAppointment(appointment.id, "Completed");
      setSelected(null);
      onNotify("Demo session ended and the visit was marked complete.", "success");
      return;
    }
    setEnding(true);
    try {
      const response = await fetch(`/api/control/live-sessions/${persisted.id}/end`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ reason: "Staff ended the authorized visit from Live Sessions." }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The session could not be ended.");
      onUpdateAppointment(appointment.id, "Completed");
      setSelected(null);
      onNotify("Visit ended, resources released, and the completion event was recorded.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "The session could not be ended.", "error");
    } finally {
      setEnding(false);
    }
  }

  async function monitorSession(appointment: Appointment) {
    const persisted = serverSessions[appointment.id];
    if (!persisted) {
      onNotify("Monitoring is available after this visit has a persisted Live Session record.", "info");
      return;
    }
    try {
      const response = await fetch(`/api/control/live-sessions/${persisted.id}/observer-token`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ reason: "Routine supervision of an authorized live visit." }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Observer authorization was denied.");
      onNotify("Observer access authorized and monitoring has been audit logged.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Observer authorization was denied.", "error");
    }
  }

  function card(appointment: Appointment, index: number, recent = false) {
    const persisted = serverSessions[appointment.id];
    const state = persisted?.status === "RECONNECTING" ? "RECONNECTING" : recent ? "ENDED" : "LIVE";
    return <button className={`sv10-session-card ${selected?.id === appointment.id ? "selected" : ""}`} key={appointment.id} onClick={() => setSelected(appointment)}><div className="sv10-card-top"><Status tone={state === "LIVE" ? "green" : state === "RECONNECTING" ? "orange" : "blue"}>{state}</Status><span>{appointment.type} visit · {appointment.id}</span></div><div className="sv10-card-people"><Avatar initials={appointment.visitorInitials} tone="orange" /><span>↔</span><Avatar initials={appointment.prisoner.replaceAll(".", "").replace(" ", "").slice(0, 2)} tone="blue" /></div><h2>{appointment.visitor} <span>↔</span> {appointment.prisoner}</h2><p>{appointment.room} · {appointment.kiosk}</p><div className="sv10-card-time"><strong>{recent ? "20:00" : index === 0 ? "11:43" : "08:16"}</strong><small>{recent ? "duration" : "remaining"}</small></div><div className="sv10-card-health"><span>Visitor <b className="green-text">Connected</b></span><span>Facility <b className={state === "RECONNECTING" ? "orange-text" : "green-text"}>{state === "RECONNECTING" ? "Reconnecting" : "Connected"}</b></span><span>Media <b>{recent ? "Video + audio" : "Video + audio"}</b></span></div><span className="sv10-open">Open session details <b>→</b></span></button>;
  }

  return <div className="sv10-live-page"><PageHeader eyebrow="Operations · Authorized monitoring" title="Live Sessions" description="See which visits are active, what each participant can do, and when staff intervention is required." actions={<><span className="sv10-active-count"><i />{live.length} ACTIVE SESSION{live.length === 1 ? "" : "S"}</span><Button variant="primary" onClick={() => onNotify("Live session roster refreshed from the protected session service.", "success")}>↻ Refresh sessions</Button></>} /><div className="sv10-live-summary"><div><span>Active now</span><strong>{live.length}</strong><small>server-authorized visits</small></div><div><span>Needs attention</span><strong>{live.filter((appointment) => serverSessions[appointment.id]?.status === "RECONNECTING").length}</strong><small>connection recovery</small></div><div><span>Recording</span><strong>OFF</strong><small>default policy</small></div><div><span>Recently ended</span><strong>{recentlyEnded.length}</strong><small>completion summaries</small></div></div><div className="sv10-workspace"><section className="sv10-session-column"><div className="sv10-section-heading"><div><span className="sv9-kicker">ACTIVE SESSIONS</span><h2>In progress</h2></div><span>{live.length} live</span></div><div className="sv10-session-grid">{live.length ? live.map((appointment, index) => card(appointment, index)) : <div className="sv10-empty"><strong>No active visits</strong><span>Visits started from Waiting Room will appear here.</span></div>}</div><div className="sv10-section-heading sv10-recent-heading"><div><span className="sv9-kicker">COMPLETION</span><h2>Recently ended</h2></div><span>{recentlyEnded.length} recorded</span></div><div className="sv10-session-grid sv10-recent-grid">{recentlyEnded.length ? recentlyEnded.slice(0, 3).map((appointment, index) => card(appointment, index, true)) : <div className="sv10-empty"><strong>Nothing ended this shift</strong><span>Completed visits and their summaries will land here.</span></div>}</div></section><aside className="sv10-ops-rail"><span className="sv9-kicker">SESSION OPERATIONS</span><h2>Keep the call safe</h2><p>Live video is never shown in this workspace by default. Open a session when you need technical context or authorized monitoring.</p><div className="sv10-rail-list"><div><span className="sv10-rail-icon">◉</span><span><strong>Media plane</strong><small>WebRTC through LiveKit</small></span></div><div><span className="sv10-rail-icon">◷</span><span><strong>Timer authority</strong><small>Server session window</small></span></div><div><span className="sv10-rail-icon">▣</span><span><strong>Recording policy</strong><small>Off unless explicitly authorized</small></span></div></div><button onClick={() => onNotify("Session health checks are available from each detail drawer.")}>Review session health →</button></aside></div>{selected ? <div className="sv10-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="sv10-drawer" role="dialog" aria-modal="true" aria-labelledby="live-session-title"><header><div><span className="sv9-kicker">SESSION DETAIL · {selected.id}</span><h2 id="live-session-title">{selected.visitor}</h2><p>{selected.prisoner} · {selected.room} · {selected.kiosk}</p></div><button aria-label="Close session details" onClick={() => setSelected(null)}>×</button></header><div className="sv10-drawer-body"><div className="sv10-drawer-state"><Status tone="green">LIVE · 11:43 REMAINING</Status><span>Timer is enforced by SecureVisit</span></div><section><span className="sv9-kicker">PARTICIPANTS</span><div className="sv10-participant-row"><Avatar initials={selected.visitorInitials} tone="orange" /><span><strong>{selected.visitor}</strong><small>Visitor · video on · audio on</small></span><b className="green-text">Connected</b></div><div className="sv10-participant-row"><Avatar initials={selected.prisoner.replaceAll(".", "").replace(" ", "").slice(0, 2)} tone="blue" /><span><strong>{selected.prisoner}</strong><small>Facility kiosk · video on · audio on</small></span><b className="green-text">Connected</b></div></section><section><span className="sv9-kicker">MEDIA & CONNECTION</span><div className="sv10-metric-grid"><div><small>Connection</small><strong>Good</strong></div><div><small>Reconnects</small><strong>0</strong></div><div><small>Video</small><strong>Active</strong></div><div><small>Audio</small><strong>Active</strong></div></div></section><section><span className="sv9-kicker">POLICY</span><div className="sv10-policy-row"><span>Recording</span><strong>Off · no media stored</strong></div><div className="sv10-policy-row"><span>Monitoring</span><strong>Not active</strong></div></section><section><span className="sv9-kicker">TECHNICAL EVENTS</span><p className="sv10-event-note">No connection incidents have been recorded for this session.</p></section></div><footer><Button onClick={() => void monitorSession(selected)}>Monitor Session</Button><Button variant="danger" disabled={ending} onClick={() => void endSession(selected)}>{ending ? "Ending…" : "End Visit"}</Button></footer></aside></div> : null}</div>;
}

function ResourcesPage({ onNotify, onReassign }: { onNotify: (message: string, tone?: Notice["tone"]) => void; onReassign: (id: string) => void }) {
  const [selected, setSelected] = useState("Kiosk 04");
  const resources = [{ name: "Room 01", type: "ROOM", status: "IN USE", detail: "Kiosk 02 · 10:20", tone: "green" }, { name: "Room 02", type: "ROOM", status: "AVAILABLE", detail: "Next visit 11:20", tone: "blue" }, { name: "Room 03", type: "ROOM", status: "IN USE", detail: "Kiosk 04 · 11:43 left", tone: "orange" }, { name: "Room 04", type: "ROOM", status: "RESERVED", detail: "Alya · 10:40", tone: "purple" }, { name: "Kiosk 02", type: "KIOSK", status: "ONLINE", detail: "Room 01 · heartbeat 4s", tone: "green" }, { name: "Kiosk 04", type: "KIOSK", status: "OFFLINE", detail: "Last heartbeat 14m", tone: "red" }, { name: "Kiosk 06", type: "KIOSK", status: "ONLINE", detail: "Available · certificate valid", tone: "blue" }, { name: "Kiosk 08", type: "KIOSK", status: "MAINTENANCE", detail: "Scheduled 15 Aug", tone: "purple" }];
  return <><PageHeader eyebrow="Operations · Resource map" title="Resources" description="The live state of every room and kiosk, including what each problem affects and the safest alternative." actions={<><Button onClick={() => onNotify("All room and kiosk heartbeats requested.")}>↻ Poll devices</Button><Button variant="primary" onClick={() => onNotify("Maintenance request opened for the selected resource.")}>+ Maintenance request</Button></>} /><div className="sv3-resource-summary"><div className="sv3-resource-hero"><span className="sv3-eyebrow">Facility capacity</span><strong>4 <small>/ 6</small></strong><p>rooms currently usable</p><div className="sv3-capacity-bar"><i style={{ width: "67%" }} /></div><span>2 rooms available · 1 device warning</span></div><div><span>Online kiosks</span><strong>7 / 8</strong><small>One missed heartbeat</small></div><div><span>Monitoring capacity</span><strong>2 / 2</strong><small>Full until 11:00</small></div></div><div className="sv3-resource-layout"><section className="sv3-resource-board"><div className="sv3-resource-board-head"><div><span className="sv3-eyebrow">Live resource board</span><h2>Rooms & kiosks</h2></div><div className="sv3-resource-legend"><span><i className="green" />Healthy</span><span><i className="orange" />Reserved</span><span><i className="red" />Attention</span></div></div><div className="sv3-resource-grid">{resources.map((resource) => <button key={resource.name} className={`sv3-resource-tile resource-${resource.tone} ${selected === resource.name ? "selected" : ""}`} onClick={() => setSelected(resource.name)}><div><span>{resource.type}</span><Status tone={resource.tone}>{resource.status}</Status></div><strong>{resource.name}</strong><small>{resource.detail}</small><i className="resource-signal" /></button>)}</div></section><aside className="sv3-resource-detail"><span className="sv3-eyebrow">Selected resource</span><h2>{selected}</h2><Status tone={selected === "Kiosk 04" ? "red" : "green"}>{selected === "Kiosk 04" ? "OFFLINE" : "OPERATIONAL"}</Status><dl><div><dt>Last heartbeat</dt><dd>{selected === "Kiosk 04" ? "14 minutes ago" : "4 seconds ago"}</dd></div><div><dt>Current reservation</dt><dd>{selected === "Kiosk 04" ? "SV-260813-031 · affected" : "None"}</dd></div><div><dt>Camera</dt><dd>{selected === "Kiosk 04" ? "Not reachable" : "Passed"}</dd></div><div><dt>Microphone</dt><dd>{selected === "Kiosk 04" ? "Not reachable" : "Passed"}</dd></div></dl>{selected === "Kiosk 04" ? <div className="sv3-resource-warning"><strong>What this affects</strong><span>SV-260813-031 · Sarah Amelia ↔ A. Rahman</span><small>Recommended alternative: Kiosk 06</small><Button variant="primary" onClick={() => onReassign("SV-260813-031")}>Reassign to Kiosk 06</Button></div> : <Button onClick={() => onNotify(`${selected} details opened.`)}>Open resource record</Button>}</aside></div></>;
}

function IncidentsPage({ selected, onSelect, onNotify }: { selected: string; onSelect: (id: string) => void; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const incidents = [{ id: "INC-260813-019", severity: "CRITICAL", title: "Unauthorized participant detected", appointment: "SV-260813-031", age: "4 min ago", assignee: "Rahman Prakoso", tone: "red" }, { id: "INC-260813-014", severity: "HIGH", title: "Device interruption", appointment: "SV-260813-033", age: "23 min ago", assignee: "Maya Santoso", tone: "orange" }, { id: "INC-260812-081", severity: "MEDIUM", title: "Visitor conduct report", appointment: "SV-260812-081", age: "Yesterday", assignee: "Unassigned", tone: "blue" }];
  const active = incidents.find((incident) => incident.id === selected) || incidents[0];
  return <><PageHeader eyebrow="Operations · Case management" title="Incidents" description="Investigate what happened, understand the affected visit, assign ownership, and record the resolution." actions={<><Status tone="red">3 OPEN</Status><Button variant="primary" onClick={() => onNotify("New incident form opened. A reason and related visit are required.")}>+ Report incident</Button></>} /><div className="sv3-incident-layout"><section className="sv3-incident-list"><div className="sv3-incident-list-head"><span>OPEN INCIDENTS</span><button>Filter · All</button></div>{incidents.map((incident) => <button className={`sv3-incident-row ${active.id === incident.id ? "active" : ""}`} key={incident.id} onClick={() => onSelect(incident.id)}><span className={`sv3-severity severity-${incident.tone}`}>{incident.severity}</span><strong>{incident.title}</strong><small>{incident.id} · {incident.age}</small><span className="sv3-incident-meta">{incident.appointment} · {incident.assignee}</span><b>›</b></button>)}<EmptyState title="No more open incidents" body="Resolved cases remain available in Compliance." action="View resolved cases" /></section><article className="sv3-incident-detail"><div className="sv3-incident-detail-head"><div><span className={`sv3-severity severity-${active.tone}`}>{active.severity}</span><span className="sv3-eyebrow">INCIDENT {active.id}</span><h2>{active.title}</h2><p>Opened {active.age} · Related appointment {active.appointment}</p></div><Button onClick={() => onNotify("Incident assignment updated.", "success")}>Assign case</Button></div><div className="sv3-incident-columns"><div><SectionLabel>Investigation timeline</SectionLabel><div className="sv3-case-timeline"><div><time>09:38</time><span /><p><strong>Session readiness failed</strong><small>Kiosk 04 stopped responding during pre-flight checks.</small></p></div><div><time>09:41</time><span /><p><strong>Officer created incident</strong><small>Maya Santoso linked the issue to {active.appointment}.</small></p></div><div><time>09:42</time><span /><p><strong>Supervisor notified</strong><small>Rahman Prakoso is reviewing the case.</small></p></div></div></div><div className="sv3-case-facts"><SectionLabel>Case facts</SectionLabel><dl><div><dt>Reporter</dt><dd>Maya Santoso</dd></div><div><dt>Assigned investigator</dt><dd>{active.assignee}</dd></div><div><dt>Affected visitor</dt><dd>Sarah Amelia</dd></div><div><dt>Evidence</dt><dd>3 event records</dd></div></dl><Button variant="secondary" onClick={() => onNotify("Evidence access request created and audit logged.")}>Request evidence access</Button></div></div><div className="sv3-resolution"><SectionLabel>Resolution</SectionLabel><p>Document actions taken and why the visit can resume, be delayed, or be cancelled.</p><Button variant="primary" onClick={() => onNotify("Resolution form opened. Case remains open until submitted.")}>Add resolution note</Button><Button variant="quiet" onClick={() => onNotify("Incident marked ready for supervisor closure.")}>Prepare closure</Button></div></article></div></>;
}

function PersonHoverCard({ name, detail, onOpen, children }: { name: string; detail: string; onOpen: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <span className="sv3-person-hover-anchor" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}><button type="button" className="sv3-person-trigger" onClick={(event) => { event.stopPropagation(); onOpen(); }}>{children}</button>{open ? <span className="sv3-hover-card" role="tooltip"><Avatar initials="SA" tone="orange" /><span><strong>{name}</strong><small>VERIFIED · ACTIVE</small></span><dl><div><dt>Relationship</dt><dd>{detail}</dd></div><div><dt>Upcoming visits</dt><dd>1 scheduled</dd></div><div><dt>Visit credits</dt><dd>2 available</dd></div></dl><b>View profile →</b></span> : null}</span>;
}

function CopyableId({ value }: { value: string }) {
  return <span className="sv3-copyable-id"><span>{value}</span><button type="button" aria-label={`Copy ${value}`} onClick={(event) => { event.stopPropagation(); void navigator.clipboard?.writeText(value); }}>⧉</button></span>;
}

function CapacityPopover({ onOpen }: { onOpen: () => void }) {
  return <div className="sv3-popover sv3-metric-popover"><span className="sv3-eyebrow">Facility capacity</span><strong>4 / 6 rooms assigned</strong><div className="sv3-popover-list"><span><b>Room 01</b><em>In use</em></span><span><b>Room 02</b><em>Available</em></span><span><b>Room 03</b><em>In use</em></span><span><b>Room 04</b><em>Maintenance</em></span><span><b>Room 05</b><em>Available</em></span><span><b>Room 06</b><em>In use</em></span></div><button type="button" onClick={onOpen}>Open Resources →</button></div>;
}

function WaitingPopover({ onOpen }: { onOpen: () => void }) {
  return <div className="sv3-popover sv3-metric-popover"><span className="sv3-eyebrow">Waiting room</span><strong>3 visitors in the readiness lanes</strong><div className="sv3-popover-list"><span><b>Sarah Amelia</b><em>Ready to admit</em></span><span><b>Daniel Wijaya</b><em>Waiting for prisoner</em></span><span><b>Alya Pratama</b><em>Device test required</em></span></div><button type="button" onClick={onOpen}>Open Waiting Room →</button></div>;
}

function SessionPopover({ onOpen }: { onOpen: () => void }) {
  return <div className="sv3-popover sv3-metric-popover"><span className="sv3-eyebrow">Session status</span><strong>LIVE · 11:43 remaining</strong><div className="sv3-popover-list"><span><b>Started</b><em className="sv3-mono-value">10:00:17</em></span><span><b>Connection</b><em>Stable</em></span><span><b>Room / kiosk</b><em>03 · 04</em></span></div><button type="button" onClick={onOpen}>Open live session →</button></div>;
}

function ContextDrawer({ payload, onClose, onOpenAppointment, onRequestApproval, onReassign, onNotify }: { payload: DrawerPayload; onClose: () => void; onOpenAppointment: (appointment: Appointment) => void; onRequestApproval: (appointment: Appointment) => void; onReassign: (id: string) => void; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const title = payload.kind === "device" ? payload.device : payload.kind === "incident" ? payload.id : payload.kind === "waiting" ? payload.visitor : payload.kind === "activity" ? payload.event : payload.appointment.id;
  const eyebrow = payload.kind === "device" ? "Device issue" : payload.kind === "incident" ? "Incident" : payload.kind === "waiting" ? "Waiting room" : payload.kind === "activity" ? "Related activity" : "Appointment";
  return <div className="sv3-drawer-backdrop" onClick={onClose}><aside className="sv3-drawer sv3-context-drawer" role="dialog" aria-modal="true" aria-labelledby="context-drawer-title" onClick={(event) => event.stopPropagation()}><div className="sv3-drawer-head"><div><span className="sv3-eyebrow">{eyebrow}</span><h2 id="context-drawer-title">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close context drawer">×</button></div>{payload.kind === "device" ? <><div className="sv3-drawer-hero"><Avatar initials="K4" tone="red" /><div><strong>Kiosk 04</strong><span>Central Facility · Room 03</span></div><Status tone="red">OFFLINE</Status></div><DrawerSection title="Status"><DetailRow label="Last heartbeat" value="14 minutes ago" mono /><DetailRow label="Software version" value="1.3.2" mono /><DetailRow label="Camera / microphone" value="Last known healthy" /></DrawerSection><DrawerSection title="Affected appointment"><CopyableId value="SV-260813-031" /><p>Sarah Amelia ↔ A. Rahman · 10:00–10:20</p></DrawerSection><DrawerSection title="Recommended alternative"><div className="sv3-recommendation"><strong>Kiosk 06</strong><Status tone="green">AVAILABLE</Status><small>Room 05 · all device checks passing</small></div></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => onReassign("SV-260813-031")}>Reassign to Kiosk 06</Button></DrawerFooter></> : payload.kind === "appointment" ? <><div className="sv3-drawer-hero"><Avatar initials={payload.appointment.visitorInitials} tone="orange" /><div><strong>{payload.appointment.visitor} ↔ {payload.appointment.prisoner}</strong><span>{payload.appointment.type} visit · {payload.appointment.date} · <span className="sv3-mono-value">{payload.appointment.time}</span></span></div><Status tone={payload.appointment.status === "Blocked" ? "red" : payload.appointment.status === "Live" ? "green" : "orange"}>{payload.appointment.status}</Status></div><DrawerSection title="Eligibility"><DetailRow label="Visitor identity" value="Verified" positive /><DetailRow label="Relationship" value={payload.appointment.issue || "Approved"} positive={!payload.appointment.issue} /><DetailRow label="Prisoner eligibility" value="Eligible" positive /><DetailRow label="Resources" value={`${payload.appointment.room} · ${payload.appointment.kiosk}`} /></DrawerSection>{payload.appointment.issue ? <div className="sv3-drawer-callout warning"><strong>Blocking condition</strong><p>{payload.appointment.issue}</p></div> : null}<DrawerSection title="Audit reference"><CopyableId value={`COR-${payload.appointment.id.slice(-5)}`} /><small>All decisions are recorded against the facility audit trail.</small></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button><Button onClick={() => onOpenAppointment(payload.appointment)}>Full appointment</Button>{payload.appointment.status !== "Approved" && payload.appointment.status !== "Live" ? <Button variant="primary" onClick={() => onRequestApproval(payload.appointment)}>Approve visit</Button> : null}</DrawerFooter></> : payload.kind === "waiting" ? <><div className="sv3-drawer-hero"><Avatar initials={payload.visitor === "Sarah Amelia" ? "SA" : "NH"} tone="orange" /><div><strong>{payload.visitor}</strong><span>Family visit · Room 03 · waiting lane</span></div><Status tone="blue">READY</Status></div><DrawerSection title="Readiness"><DetailRow label="Identity" value="Confirmed" positive /><DetailRow label="Camera" value="Passed" positive /><DetailRow label="Microphone" value="Passed" positive /><DetailRow label="Prisoner" value="Not confirmed" /></DrawerSection><div className="sv3-drawer-callout"><strong>Recommended action</strong><p>Contact Unit 4 before admitting the visitor so both sides enter the session together.</p></div><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => { onClose(); onNotify("Unit 4 has been contacted about the waiting visitor.", "success"); }}>Contact unit</Button></DrawerFooter></> : payload.kind === "incident" ? <><div className="sv3-drawer-hero"><span className="sv3-action-icon red">!</span><div><strong>Unauthorized participant detected</strong><span>Related appointment · SV-260813-031</span></div><Status tone="red">CRITICAL</Status></div><DrawerSection title="Current response"><DetailRow label="Opened" value="4 minutes ago" mono /><DetailRow label="Assigned investigator" value="Unassigned" /><DetailRow label="Evidence" value="3 event records" /></DrawerSection><div className="sv3-drawer-callout warning"><strong>Resolution needed</strong><p>Assign an investigator before the live session can be closed.</p></div><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => { onClose(); onNotify("Incident assigned to Rahman Prakoso.", "success"); }}>Assign Rahman</Button></DrawerFooter></> : <><div className="sv3-drawer-hero"><span className="sv3-action-icon blue">•</span><div><strong>{payload.event}</strong><span>{payload.source} · related operational record</span></div><Status tone="blue">RECORDED</Status></div><DrawerSection title="Event context"><p>This activity is linked to the facility timeline and can be traced through the audit correlation chain.</p><CopyableId value={payload.relatedId.startsWith("SV-") ? payload.relatedId : "COR-93838"} /></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => onNotify("Related record is already open in the current operational context.")}>View related record</Button></DrawerFooter></>}</aside></div>;
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) { return <section className="sv3-drawer-section"><span className="sv3-eyebrow">{title}</span>{children}</section>; }
function DetailRow({ label, value, mono = false, positive = false }: { label: string; value: string; mono?: boolean; positive?: boolean }) { return <div className="sv3-detail-row"><span>{label}</span><strong className={`${mono ? "sv3-mono-value" : ""} ${positive ? "sv3-positive" : ""}`}>{positive ? "✓ " : ""}{value}</strong></div>; }
function DrawerFooter({ children }: { children: ReactNode }) { return <div className="sv3-drawer-actions">{children}</div>; }

function ImpactDialog({ appointment, onClose, onConfirm }: { appointment: Appointment; onClose: () => void; onConfirm: () => void }) {
  return <div className="sv3-modal-backdrop" onClick={onClose}><section className="sv3-dialog sv3-impact-dialog" role="dialog" aria-modal="true" aria-labelledby="impact-title" onClick={(event) => event.stopPropagation()}><div className="sv3-dialog-head"><div><span className="sv3-eyebrow">Approval impact</span><h2 id="impact-title">Approve visit</h2><p>{appointment.visitor} ↔ {appointment.prisoner} · <span className="sv3-mono-value">{appointment.time}</span></p></div><button type="button" onClick={onClose} aria-label="Close approval dialog">×</button></div><div className="sv3-impact-list"><strong>Approval will:</strong><span>✓ Reserve {appointment.room}</span><span>✓ Reserve {appointment.kiosk}</span><span>✓ Reserve 1 Visit Credit</span><span>✓ Notify visitor and assigned staff</span><span>✓ Create an audit event</span></div><div className="sv3-policy-check"><strong>Policy checks</strong><span>✓ No blocking conditions detected</span></div><div className="sv3-dialog-actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={onConfirm}>Approve visit</Button></div></section></div>;
}

function AlertDialog({ title, description, stats, onCancel, onConfirm }: { title: string; description: string; stats: string[]; onCancel: () => void; onConfirm: () => void }) {
  return <div className="sv3-modal-backdrop" onClick={onCancel}><section className="sv3-dialog sv3-alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="alert-title" onClick={(event) => event.stopPropagation()}><div className="sv3-dialog-head"><div><span className="sv3-eyebrow">Destructive facility command</span><h2 id="alert-title">{title}</h2><p>{description}</p></div><button type="button" onClick={onCancel} aria-label="Close lockdown dialog">×</button></div><div className="sv3-lockdown-stats">{stats.map((stat) => <div key={stat}><strong>{stat.split(" ")[0]}</strong><span>{stat.slice(stat.indexOf(" ") + 1)}</span></div>)}</div><label className="sv3-dialog-field">Reason<select defaultValue=""><option value="" disabled>Select reason</option><option>Security incident</option><option>Facility emergency</option><option>Technical containment</option></select></label><label className="sv3-dialog-field">Details<textarea defaultValue="Controlled demo lockdown for operational propagation review." /></label><p className="sv3-alert-note">This action is facility-wide and will be recorded in the audit trail.</p><div className="sv3-dialog-actions"><Button variant="quiet" onClick={onCancel}>Keep normal operations</Button><Button variant="danger" onClick={onConfirm}>Declare lockdown</Button></div></section></div>;
}

function CommandPalette({ appointments, onClose, onOpenAppointment, onOpenDrawer, onNavigate }: { appointments: Appointment[]; onClose: () => void; onOpenAppointment: (appointment: Appointment) => void; onOpenDrawer: (payload: DrawerPayload) => void; onNavigate: (page: string) => void }) {
  const [query, setQuery] = useState("");
  const results = appointments.filter((appointment) => `${appointment.id} ${appointment.visitor} ${appointment.prisoner}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4);
  return <div className="sv3-modal-backdrop sv3-command-palette-backdrop" onClick={onClose}><section className="sv3-command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-title" onClick={(event) => event.stopPropagation()}><div className="sv3-palette-search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, appointments, resources…" /></div><div className="sv3-palette-group"><span className="sv3-eyebrow" id="palette-title">Appointments</span>{results.map((appointment) => <button type="button" key={appointment.id} onClick={() => { onClose(); onOpenAppointment(appointment); }}><span><strong>{appointment.id}</strong><small>{appointment.visitor} ↔ {appointment.prisoner}</small></span><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "blue"}>{appointment.status}</Status></button>)}</div><div className="sv3-palette-group"><span className="sv3-eyebrow">Actions</span><button type="button" onClick={() => { onClose(); onOpenDrawer({ kind: "device", device: "Kiosk 04" }); }}>Open Kiosk 04 issue</button><button type="button" onClick={() => { onClose(); onNavigate("Waiting Room"); }}>Open Waiting Room</button><button type="button" onClick={() => { onClose(); onNavigate("Resources"); }}>Go to Resources</button></div><div className="sv3-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div></section></div>;
}

function AppointmentDrawer({ appointment, onClose, onRequestApproval, onUpdate }: { appointment: Appointment; onClose: () => void; onRequestApproval: () => void; onUpdate: (id: string, status: AppointmentStatus) => void }) {
  return <div className="sv3-drawer-backdrop" onClick={onClose}><aside className="sv3-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-drawer-title" onClick={(event) => event.stopPropagation()}><div className="sv3-drawer-head"><div><span className="sv3-eyebrow">Appointment review</span><h2 id="appointment-drawer-title"><CopyableId value={appointment.id} /></h2></div><button onClick={onClose} aria-label="Close review">×</button></div><div className="sv3-drawer-person"><Avatar initials={appointment.visitorInitials} tone="orange" /><div><strong>{appointment.visitor}</strong><span>{appointment.type} visit with {appointment.prisoner}</span></div><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "orange"}>{appointment.status}</Status></div><div className="sv3-drawer-details"><div><span>Requested</span><strong className="sv3-mono-value">{appointment.date} · {appointment.time}</strong></div><div><span>Resources</span><strong>{appointment.room} · {appointment.kiosk}</strong></div><div><span>Relationship</span><strong>Sister · approved</strong></div><div><span>Credits</span><strong>1 available · reservation ready</strong></div></div><div className="sv3-approval-preview"><span className="sv3-eyebrow">If approved</span><p>This action will reserve the room, kiosk, monitoring slot, and one Visit Credit; notify the visitor; and create an audit event.</p><span>✓ Eligibility checks passed</span><span>✓ Visitor identity verified</span><span>! Relationship evidence requires review</span></div><div className="sv3-drawer-actions"><Button variant="quiet" onClick={onClose}>Close</Button>{appointment.status !== "Approved" && appointment.status !== "Live" ? <><Button variant="danger" onClick={() => onUpdate(appointment.id, "Blocked")}>Decline</Button><Button variant="primary" onClick={onRequestApproval}>Approve visit</Button></> : null}</div></aside></div>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyAppointmentDrawer({ appointment, onClose, onUpdate }: { appointment: Appointment; onClose: () => void; onUpdate: (id: string, status: AppointmentStatus) => void }) {
  return <div className="sv3-drawer-backdrop" onClick={onClose}><aside className="sv3-drawer" onClick={(event) => event.stopPropagation()}><div className="sv3-drawer-head"><div><span className="sv3-eyebrow">Appointment review</span><h2>{appointment.id}</h2></div><button onClick={onClose} aria-label="Close review">×</button></div><div className="sv3-drawer-person"><Avatar initials={appointment.visitorInitials} tone="orange" /><div><strong>{appointment.visitor}</strong><span>{appointment.type} visit with {appointment.prisoner}</span></div><Status tone={appointment.status === "Blocked" ? "red" : "orange"}>{appointment.status}</Status></div><div className="sv3-drawer-details"><div><span>Requested</span><strong>{appointment.date} · {appointment.time}</strong></div><div><span>Resources</span><strong>{appointment.room} · {appointment.kiosk}</strong></div><div><span>Relationship</span><strong>Sister · approved</strong></div><div><span>Credits</span><strong>1 available · reservation ready</strong></div></div><div className="sv3-approval-preview"><span className="sv3-eyebrow">If approved</span><p>This action will reserve the room, kiosk, monitoring slot, and one Visit Credit; notify the visitor; and create an audit event.</p><span>✓ Eligibility checks passed</span><span>✓ Visitor identity verified</span><span>! Relationship evidence requires review</span></div><div className="sv3-drawer-actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => onUpdate(appointment.id, "Blocked")}>Decline</Button><Button variant="primary" onClick={() => onUpdate(appointment.id, "Approved")}>Approve visit</Button></div></aside></div>;
}

function PeoplePage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Visitors");
  const [search, setSearch] = useState("");
  const [selectedName, setSelectedName] = useState("Sarah Amelia");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [visitFilter, setVisitFilter] = useState("All visits");
  const visitorRows: PeopleRecord[] = [
    { name: "Sarah Amelia", status: "VERIFIED", connection: "A. Rahman", relationship: "Wife · Approved", nextDate: "Today", nextTime: "10:00–10:20 WIB · Room 03", activity: "Upcoming visit", initials: "SA", tone: "orange", meta: "Visitor · VST-SA" },
    { name: "Daniel Wijaya", status: "VERIFIED", connection: "R. Santoso", relationship: "Brother · Approved", nextDate: "Today", nextTime: "10:20–10:40 WIB · Room 01", activity: "Upcoming visit", initials: "DW", tone: "blue", meta: "Visitor · VST-DW" },
    { name: "Alya Pratama", status: "PENDING", connection: "F. Pratama", relationship: "Sister · Review required", nextDate: "Today", nextTime: "10:40–11:00 WIB · Room 04", activity: "Request pending", initials: "AP", tone: "orange", meta: "Visitor · VST-AP" },
    { name: "Nurul Hidayah", status: "VERIFIED", connection: "F. Hidayat", relationship: "Mother · Approved", nextDate: "Tomorrow", nextTime: "09:00–09:20 WIB · Room 02", activity: "Upcoming visit", initials: "NH", tone: "purple", meta: "Visitor · VST-NH" },
    { name: "Rina Kusuma", status: "VERIFIED", connection: "A. Hakim", relationship: "Sister · Approved", nextDate: "Friday", nextTime: "14:00–14:20 WIB · Room 01", activity: "Upcoming visit", initials: "RK", tone: "blue", meta: "Visitor · VST-RK" },
    { name: "Fajar Mahendra", status: "NEEDS INFO", connection: "B. Prakoso", relationship: "Brother · Evidence needed", nextDate: "No upcoming visit", nextTime: "—", activity: "Request pending", initials: "FM", tone: "orange", meta: "Visitor · VST-FM" },
    { name: "Dewi Anggraini", status: "VERIFIED", connection: "M. Yusuf", relationship: "Spouse · Approved", nextDate: "Saturday", nextTime: "11:20–11:40 WIB · Room 04", activity: "Upcoming visit", initials: "DA", tone: "purple", meta: "Visitor · VST-DA" },
    { name: "Bima Saputra", status: "PENDING", connection: "R. Santoso", relationship: "Counsel · Pending", nextDate: "No upcoming visit", nextTime: "—", activity: "Request pending", initials: "BS", tone: "blue", meta: "Visitor · VST-BS" },
    { name: "Siti Rahma", status: "VERIFIED", connection: "F. Hidayat", relationship: "Mother · Approved", nextDate: "20 Aug", nextTime: "13:00–13:20 WIB · Room 02", activity: "Upcoming visit", initials: "SR", tone: "orange", meta: "Visitor · VST-SR" },
    { name: "Rafi Pranoto", status: "VERIFIED", connection: "B. Aditya", relationship: "Brother · Approved", nextDate: "22 Aug", nextTime: "09:40–10:00 WIB · Room 03", activity: "Upcoming visit", initials: "RP", tone: "blue", meta: "Visitor · VST-RP" },
  ];
  const otherRows: PeopleRecord[] = tab === "Prisoners" ? [{ name: "A. Rahman", status: "ACTIVE", connection: "6 approved visitors", relationship: "Family and legal contacts", nextDate: "Today", nextTime: "10:00 WIB · Room 03", activity: "Upcoming visit", initials: "AR", tone: "blue", meta: "Prisoner · CCF-AR" }, { name: "R. Santoso", status: "ACTIVE", connection: "4 approved visitors", relationship: "Family contacts", nextDate: "Today", nextTime: "10:20 WIB · Room 01", activity: "Upcoming visit", initials: "RS", tone: "blue", meta: "Prisoner · CCF-RS" }, { name: "F. Pratama", status: "RESTRICTED", connection: "2 approved visitors", relationship: "Review required", nextDate: "No upcoming visit", nextTime: "—", activity: "Needs review", initials: "FP", tone: "purple", meta: "Prisoner · CCF-FP" }] : tab === "Verifications" ? [{ name: "Nurul Hidayah", status: "PENDING", connection: "Passport · expires 2027", relationship: "Identity evidence", nextDate: "Submitted today", nextTime: "SLA · 8 min", activity: "Review queue", initials: "NH", tone: "purple", meta: "Applicant · VST-NH" }, { name: "Fajar Mahendra", status: "NEEDS INFO", connection: "Address evidence", relationship: "Additional proof requested", nextDate: "Submitted today", nextTime: "SLA · 22 min", activity: "Needs information", initials: "FM", tone: "orange", meta: "Applicant · VST-FM" }, { name: "Dewi Anggraini", status: "EXPIRING", connection: "Identity refresh", relationship: "Passport renewal", nextDate: "Due this week", nextTime: "SLA · 1 hour", activity: "Review queue", initials: "DA", tone: "blue", meta: "Applicant · VST-DA" }] : [{ name: "Alya Pratama", status: "UNDER REVIEW", connection: "F. Pratama", relationship: "Sister · Family card attached", nextDate: "Submitted today", nextTime: "Review · 14 min", activity: "Relationship request", initials: "AP", tone: "orange", meta: "Request · REL-AP" }, { name: "Dimas Wirawan", status: "ESCALATED", connection: "B. Aditya", relationship: "Counsel · Supervisor review", nextDate: "Submitted today", nextTime: "Review · 28 min", activity: "Escalated request", initials: "DW", tone: "purple", meta: "Request · REL-DW" }, { name: "Sarah Amelia", status: "APPROVED", connection: "A. Rahman", relationship: "Wife · Approved relationship", nextDate: "Approved 02 Aug", nextTime: "Next visit · Today", activity: "Active connection", initials: "SA", tone: "orange", meta: "Request · REL-SA" }];
  const rows = tab === "Visitors" ? visitorRows : otherRows;
  const filtered = rows.filter((row) => row.name.toLowerCase().includes(search.toLowerCase()) || row.meta.toLowerCase().includes(search.toLowerCase()) || `${row.connection} ${row.relationship}`.toLowerCase().includes(search.toLowerCase())).filter((row) => statusFilter === "All statuses" || row.status === statusFilter).filter((row) => visitFilter === "All visits" || (visitFilter === "Upcoming" ? row.nextDate !== "No upcoming visit" : row.nextDate === "No upcoming visit"));
  const selected = rows.find((row) => row.name === selectedName) || rows[0];
  const tabs = [["Visitors", "45"], ["Prisoners", "31"], ["Verifications", "6"], ["Relationships", "4"]];
  const statusTone = (status: string) => ["VERIFIED", "ACTIVE", "APPROVED"].includes(status) ? "green" : ["RESTRICTED", "ESCALATED"].includes(status) ? "red" : status === "UNDER REVIEW" ? "purple" : "orange";
  // The directory rows use button semantics for keyboard selection; aria-pressed is the equivalent state exposed by the control.
  // eslint-disable-next-line jsx-a11y/role-supports-aria-props
  return <div className="sv6-people-page"><PageHeader eyebrow="Management · People" title="People" description="Manage visitors, prisoners, verification, and approved connections behind SecureVisit visitation." actions={<><Button onClick={() => onNotify("People export queued with facility scope applied.")}>Export scoped list</Button><Button variant="primary" onClick={() => onNotify("Controlled record creation flow opened.")}>+ Add record</Button></>} /><div className="sv6-people-summary"><span><b>45</b> Visitors</span><i /><span><b>31</b> Prisoners</span><i /><span className="needs-review"><b>6</b> Awaiting verification</span><i /><span className="needs-review"><b>4</b> Relationship requests</span></div><div className="sv3-entity-tabs sv6-entity-tabs">{tabs.map(([item, count]) => <button className={tab === item ? "active" : ""} key={item} onClick={() => { setTab(item); setSearch(""); setStatusFilter("All statuses"); setVisitFilter("All visits"); }}>{item} <em>{count}</em></button>)}</div><div className="sv3-people-layout sv6-people-layout"><section className="sv3-people-directory sv6-people-directory"><div className="sv3-directory-head sv6-directory-head"><div><span className="sv3-eyebrow">{tab}</span><h2>{tab === "Visitors" ? "Visitor directory" : `${tab} workspace`}</h2><p>{tab === "Visitors" ? `${rows.length} visible profiles · 45 total records` : `${rows.length} records in this review surface`}</p></div><div className="sv6-directory-controls"><label className="sv3-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, visitor ID, or connection" /></label><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{Array.from(new Set(rows.map((row) => row.status))).map((status) => <option key={status}>{status}</option>)}</select><select aria-label="Filter by visit" value={visitFilter} onChange={(event) => setVisitFilter(event.target.value)}><option>All visits</option><option>Upcoming</option><option>No upcoming visit</option></select></div></div>{search || statusFilter !== "All statuses" || visitFilter !== "All visits" ? <div className="sv6-active-filters"><span>Filters active</span><button onClick={() => { setSearch(""); setStatusFilter("All statuses"); setVisitFilter("All visits"); }}>Clear all ×</button></div> : null}<div className="sv3-people-table-head sv6-people-table-head"><span>Person</span><span>Status</span><span>Connection</span><span>Next visit</span><span>Activity</span><span /></div>{filtered.length ? filtered.map((row) => <button className={`sv3-person-row sv6-person-row ${selected?.name === row.name ? "selected" : ""}`} aria-selected={selected?.name === row.name} key={`${tab}-${row.name}`} onClick={() => setSelectedName(row.name)}><span className="sv3-table-person"><Avatar initials={row.initials} tone={row.tone} /><span><strong>{row.name}</strong><small>{row.meta}</small></span></span><Status tone={statusTone(row.status)}>{row.status}</Status><span className="sv6-connection-cell"><strong>{row.connection}</strong><small>{row.relationship}</small></span><span className="sv6-visit-cell"><strong>{row.nextDate}</strong><small>{row.nextTime}</small></span><span className="sv6-activity-cell">{row.activity}</span><b>›</b></button>) : <div className="sv6-people-empty"><strong>No {tab.toLowerCase()} found</strong><p>Try a different name, visitor ID, or connection.</p><Button onClick={() => { setSearch(""); setStatusFilter("All statuses"); setVisitFilter("All visits"); }}>Clear search</Button></div>}<div className="sv6-directory-footer"><span>Showing {filtered.length ? "1" : "0"}–{filtered.length} of {rows.length} visible records</span><span>Demo facility · live scope</span></div></section><aside className="sv3-profile-teaser sv6-profile-teaser">{selected ? <><span className="sv3-eyebrow">Selected profile</span><div className="sv6-profile-hero"><Avatar initials={selected.initials} tone={selected.tone} /><div><h2>{selected.name}</h2><p>{selected.meta}</p><Status tone={statusTone(selected.status)}>{selected.status === "VERIFIED" ? "VERIFIED VISITOR" : selected.status}</Status></div></div><div className="sv6-profile-motif"><span /><i /><span /></div><div className="sv6-profile-sections"><div><dt>Connection</dt><dd><strong>{selected.connection}</strong><span>{selected.relationship}</span></dd></div><div><dt>Next visit</dt><dd><strong>{selected.nextDate}</strong><span>{selected.nextTime}</span></dd></div><div><dt>Visit Credits</dt><dd><strong>2 available</strong><span>1 reserved</span></dd></div><div><dt>Incidents</dt><dd><strong>No open incidents</strong><span>Nothing requires attention</span></dd></div></div><Button variant="primary" onClick={() => onNotify(`${selected.name} full profile opened.`)}>Open full profile →</Button><button className="sv6-profile-link" onClick={() => onNotify(`${selected.name} activity opened.`)}>View activity →</button></> : <EmptyState title="No profile selected" body="Select a record to inspect its operational context." />}</aside></div><div className="sv6-people-review"><div><span className="sv3-eyebrow">Needs review</span><h2>People work that needs a decision</h2></div><div className="sv6-review-item"><strong>6 verification requests</strong><span>Oldest request · 22 min</span><button onClick={() => { setTab("Verifications"); setStatusFilter("PENDING"); }}>Review verification →</button></div><div className="sv6-review-item"><strong>4 relationship requests</strong><span>Alya Pratama · evidence attached</span><button onClick={() => { setTab("Relationships"); setStatusFilter("UNDER REVIEW"); }}>Review relationships →</button></div></div></div>;
}

function VisitationPage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Appointment Types");
  const [enabled, setEnabled] = useState(true);
  return <><PageHeader eyebrow="Management · Visitation policy" title="Visitation" description={<>Maintain the rules that define the schedule. Today&apos;s live appointments stay in Operations.</>} actions={<Button variant="primary" onClick={() => onNotify("Policy changes saved as a draft for supervisor review.", "success")}>Save policy draft</Button>} /><div className="sv3-policy-layout"><nav className="sv3-policy-nav">{["Appointment Types", "Availability Rules", "Visit Policies", "Operating Hours", "Closures"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}><span>{item}</span><b>›</b></button>)}</nav><section className="sv3-policy-editor"><div className="sv3-policy-editor-head"><div><span className="sv3-eyebrow">Policy catalog</span><h2>{tab}</h2></div><Status tone="green">DRAFT IN SYNC</Status></div>{tab === "Appointment Types" ? <div className="sv3-policy-cards"><article><div><span className="sv3-policy-icon orange">⌁</span><Status tone="green">ACTIVE</Status></div><h3>Family Visit</h3><p>Standard family contact for approved relationships.</p><dl><div><dt>Duration</dt><dd>20 minutes</dd></div><div><dt>Credit required</dt><dd>Yes · 1</dd></div><div><dt>Weekly limit</dt><dd>3 visits</dd></div><div><dt>Recording</dt><dd>Policy controlled</dd></div></dl><Button onClick={() => onNotify("Family Visit policy editor opened.")}>Edit policy</Button></article><article><div><span className="sv3-policy-icon blue">§</span><Status tone="green">ACTIVE</Status></div><h3>Legal Visit</h3><p>Privileged contact with different monitoring and recording rules.</p><dl><div><dt>Duration</dt><dd>40 minutes</dd></div><div><dt>Credit required</dt><dd>Waived</dd></div><div><dt>Weekly limit</dt><dd>By case</dd></div><div><dt>Recording</dt><dd>Prohibited</dd></div></dl><Button onClick={() => onNotify("Legal Visit policy editor opened.")}>Edit policy</Button></article></div> : <div className="sv3-settings-surface"><div className="sv3-rule-line"><div><strong>{tab === "Availability Rules" ? "Minimum scheduling buffer" : tab === "Visit Policies" ? "Require prisoner confirmation" : tab === "Operating Hours" ? "Central Facility operating hours" : "August training closure"}</strong><small>{tab === "Availability Rules" ? "Time between consecutive visits in the same room." : tab === "Visit Policies" ? "A visit cannot enter Waiting Room until the unit confirms readiness." : tab === "Operating Hours" ? "Monday–Saturday · Asia/Jakarta" : "12 Aug 2026 · 08:00–12:00"}</small></div><label className="sv3-switch"><input type="checkbox" checked={enabled} onChange={() => setEnabled((current) => !current)} /><i /></label></div><div className="sv3-form-grid"><label>Effective from<input defaultValue={tab === "Operating Hours" ? "08:00" : "13 Aug 2026"} /></label><label>Review owner<select defaultValue="Supervisor"><option>Supervisor</option><option>Facility administrator</option></select></label><label>Reason<textarea defaultValue="Keep the demo facility rule visible and explicitly scoped." /></label></div><Button variant="primary" onClick={() => onNotify(`${tab} draft updated.`, "success")}>Update {tab.toLowerCase()}</Button></div>}</section></div></>;
}

function FinancePage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Overview");
  return <><PageHeader eyebrow="Management · Financial controls" title="Finance" description="Credits, payments, refunds, and reconciliation in one financial workspace." actions={<Button variant="primary" onClick={() => onNotify("Reconciliation run started.", "success")}>Run reconciliation</Button>} /><div className="sv3-finance-tabs">{["Overview", "Ledger", "Payments", "Refunds", "Reconciliation"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "Overview" ? <div className="sv3-finance-overview"><div className="sv3-finance-metrics"><Metric label="Credits purchased" value="48" detail="Today · +8 vs yesterday" tone="green" /><Metric label="Credits consumed" value="31" detail="Today · 65% of purchased" tone="blue" /><Metric label="Credits reserved" value="19" detail="Across 14 appointments" tone="orange" /><Metric label="Refund cases" value="3" detail="1 needs approval" tone="red" /></div><div className="sv3-finance-lower"><section className="sv3-surface sv3-ledger-preview"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Append-only ledger</span><h2>Recent activity</h2></div><button className="sv3-link-button" onClick={() => setTab("Ledger")}>Open ledger →</button></div>{[["09:42", "Credit reserved", "Sarah Amelia · SV-260813-031", "-1 available · +1 reserved", "Balanced"], ["09:21", "Credits purchased", "Daniel Wijaya · payment PMT-8821", "+3 available", "Settled"], ["08:58", "Reservation released", "Visit cancelled by facility", "+1 available · -1 reserved", "Balanced"]].map((row) => <div className="sv3-ledger-row" key={row[0]}><time>{row[0]}</time><span><strong>{row[1]}</strong><small>{row[2]}</small></span><span>{row[3]}</span><Status tone="green">{row[4]}</Status></div>)}</section><aside className="sv3-reconcile-card"><span className="sv3-eyebrow">Reconciliation</span><strong>✓ Ledger balanced</strong><p>Last check 08:30 · all appointment settlements matched.</p><Button onClick={() => onNotify("All three financial control checks passed.", "success")}>Review controls</Button></aside></div></div> : <div className="sv3-finance-tab-content"><div className="sv3-finance-tab-head"><div><span className="sv3-eyebrow">{tab}</span><h2>{tab === "Ledger" ? "Credit ledger" : tab === "Refunds" ? "Refund cases" : tab === "Payments" ? "Provider transactions" : "Control checks"}</h2></div><span className="sv3-toolbar-meta">Fictional demo data · 13 Aug 2026</span></div>{tab === "Reconciliation" ? <div className="sv3-control-checks"><ControlCheck label="Credit ledger" detail="All balances agree with entries" /><ControlCheck label="Payments" detail="32 provider transactions matched" /><ControlCheck label="Appointments" detail="All completed paid visits settled" /><ControlCheck label="Webhooks" detail="1 unmatched payment webhook" warning /></div> : <div className="sv3-finance-table">{(tab === "Refunds" ? [["RF-260813-008", "Sarah Amelia", "Facility cancellation", "1 Visit Credit", "PENDING APPROVAL"], ["RF-260812-004", "Dimas Wirawan", "Technical failure", "1 Visit Credit", "APPROVED"]] : [["PMT-8821", "Daniel Wijaya", "3 Visit Credits", "Succeeded", "08:21"], ["PMT-8819", "Sarah Amelia", "2 Visit Credits", "Succeeded", "07:48"], ["PMT-8804", "Nurul Hidayah", "1 Visit Credit", "Refunded", "Yesterday"]]).map((row) => <button key={row[0]} onClick={() => onNotify(`${row[0]} details opened.`)}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><span>{row[3]}</span><Status tone={row[4].includes("PENDING") ? "orange" : "green"}>{row[4]}</Status><b>→</b></button>)}</div>}</div>}</>;
}

function ControlCheck({ label, detail, warning = false }: { label: string; detail: string; warning?: boolean }) {
  return <div className={`sv3-control-check ${warning ? "warning" : ""}`}><span>{warning ? "!" : "✓"}</span><div><strong>{label}</strong><small>{detail}</small></div><b>{warning ? "Review" : "Passed"}</b></div>;
}

function CompliancePage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Audit");
  const [events, setEvents] = useState([["09:42:16", "APPOINTMENT APPROVED", "Maya Santoso · Scheduling Officer", "SV-260813-031", "All eligibility requirements satisfied", "COR-93842"], ["09:38:04", "DEVICE HEALTH WARNING", "System monitor", "Kiosk 04", "Heartbeat missed for 10 minutes", "COR-93838"], ["09:21:33", "CREDIT RESERVED", "System", "Sarah Amelia", "One Visit Credit reserved", "COR-93821"]]);
  useEffect(() => { fetch("/api/audit/events?limit=20", { headers: { accept: "application/json" } }).then(async (response) => { if (!response.ok) return; const body = await response.json(); if (body.events?.length) setEvents(body.events.map((event: { createdAt: string; actionType: string; actorRole?: string | null; entityId?: string | null; reason?: string | null; correlationId: string }) => [event.createdAt.slice(11, 19), event.actionType, event.actorRole || "System", event.entityId || "Facility", event.reason || "Recorded action", event.correlationId])); }).catch(() => undefined); }, []);
  return <><PageHeader eyebrow="Management · Compliance" title="Compliance" description="Investigate the record of what changed, who accessed sensitive material, and which reports are ready." actions={<><Button onClick={() => onNotify("Audit integrity verified for the current facility scope.", "success")}>✓ Verify integrity</Button><Button variant="primary" onClick={() => onNotify("Scoped compliance export requested.")}>Export scoped report</Button></>} /><div className="sv3-compliance-tabs">{["Audit", "Recording Access", "Reports", "Security Events"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "Audit" ? <div className="sv3-audit-layout"><section className="sv3-audit-stream"><div className="sv3-audit-head"><div><span className="sv3-eyebrow">Chronological investigation trail</span><h2>Facility audit</h2></div><span className="sv3-toolbar-meta">{events.length} events · live scope</span></div>{events.map((event) => <button className="sv3-audit-event" key={event[5]} onClick={() => onNotify(`${event[5]} expanded with before-and-after values.`)}><time>{event[0]}</time><span className="sv3-audit-dot" /><div><strong>{event[1]}</strong><small>{event[2]} · {event[3]}</small><p>{event[4]}</p><em>Correlation {event[5]}</em></div><b>›</b></button>)}</section><aside className="sv3-audit-side"><div className="sv3-surface"><span className="sv3-eyebrow">Access posture</span><strong className="sv3-posture">Protected</strong><p>Identity, facility scope, and permission checks are enforced before sensitive records are returned.</p><div className="sv3-posture-line"><span>Audit retention</span><b>Configured</b></div><div className="sv3-posture-line"><span>Request IDs</span><b>Enabled</b></div><div className="sv3-posture-line"><span>Outbox</span><b>12 pending</b></div></div><div className="sv3-surface"><span className="sv3-eyebrow">Need to investigate?</span><h2>Open a case</h2><p>Link audit events, appointment records, and evidence access into a controlled review.</p><Button variant="primary" onClick={() => onNotify("Compliance investigation case opened.")}>Start investigation</Button></div></aside></div> : <ComplianceTab tab={tab} onNotify={onNotify} />}</>;
}

function ComplianceTab({ tab, onNotify }: { tab: string; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  if (tab === "Recording Access") return <div className="sv3-review-cases"><div className="sv3-review-case urgent"><Status tone="orange">SUPERVISOR APPROVAL REQUIRED</Status><h2>Recording REC-260812-010</h2><p>Requested by Arif Nugraha · Reason: incident investigation</p><div><span>Related session</span><strong>Sarah Amelia ↔ A. Rahman · 04 Aug</strong></div><Button variant="primary" onClick={() => onNotify("Recording access request routed to Supervisor Rahman.")}>Review request</Button></div><div className="sv3-review-case"><Status tone="green">AUTHORIZED</Status><h2>Recording REC-260811-006</h2><p>Requested by Maya Santoso · Reason: quality review</p><div><span>Expires</span><strong>13 Aug 2026 · 18:00 WIB</strong></div><Button onClick={() => onNotify("Access receipt opened.")}>Open access receipt</Button></div></div>;
  if (tab === "Reports") return <div className="sv3-report-grid">{[["Daily operations", "13 Aug 2026", "Appointments, exceptions, capacity", "READY"], ["Credit reconciliation", "July 2026", "Ledger and fictional payment events", "READY"], ["Access review", "Q3 2026", "Sensitive recording and audit access", "DRAFT"]].map((report) => <button key={report[0]} onClick={() => onNotify(`${report[0]} opened.`)}><span className="sv3-report-icon">▤</span><strong>{report[0]}</strong><small>{report[1]} · {report[2]}</small><Status tone={report[3] === "READY" ? "green" : "orange"}>{report[3]}</Status><b>Open report →</b></button>)}</div>;
  return <div className="sv3-security-events"><div className="sv3-security-event critical"><span>!</span><div><strong>Cross-facility access denied</strong><small>13 Aug · 09:31 · Policy engine</small></div><Status tone="red">CRITICAL</Status></div><div className="sv3-security-event"><span>✓</span><div><strong>Security event review completed</strong><small>13 Aug · 08:30 · Rahman Prakoso</small></div><Status tone="green">RESOLVED</Status></div><Button variant="secondary" onClick={() => onNotify(`${tab} filtered to current facility scope.`)}>Apply facility scope</Button></div>;
}

function FacilityPage({ facilityState, onNotify }: { facilityState: string; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Profile");
  return <><PageHeader eyebrow="Management · Facility configuration" title="Facility" description="Configure what Central Facility is, how it operates, and which rules its live operations must follow." actions={<Button variant="primary" onClick={() => onNotify("Facility configuration saved as a draft.", "success")}>Save configuration</Button>} /><div className="sv3-facility-layout"><nav className="sv3-facility-nav">{["Profile", "Operating Hours", "Rooms", "Devices", "Restrictions", "Closures", "Visit Policies"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}<b>›</b></button>)}</nav><section className="sv3-facility-editor"><div className="sv3-facility-editor-head"><div><span className="sv3-eyebrow">Central Correctional Facility</span><h2>{tab}</h2></div><Status tone={facilityState === "LOCKDOWN" ? "red" : "green"}>{facilityState === "LOCKDOWN" ? "LOCKDOWN" : "NORMAL"}</Status></div>{tab === "Profile" ? <div className="sv3-facility-profile"><div className="sv3-facility-map"><span>CCF</span><small>Jakarta · ID-JKT-CCF-01</small><i>⌖</i></div><div className="sv3-form-grid"><label>Facility name<input defaultValue="Central Correctional Facility" /></label><label>Timezone<select defaultValue="Asia/Jakarta"><option>Asia/Jakarta</option><option>Asia/Makassar</option></select></label><label>Facility reference<input defaultValue="ID-JKT-CCF-01" /></label><label>Operational state<input value={facilityState === "LOCKDOWN" ? "Lockdown" : "Normal operations"} readOnly /></label><label>Address<textarea defaultValue="Jakarta · fictional demo facility" /></label></div></div> : <div className="sv3-facility-table">{(tab === "Rooms" ? [["Room 01", "Family visit", "6 seats", "Active"], ["Room 02", "Family visit", "6 seats", "Active"], ["Room 03", "Family visit", "6 seats", "Active"], ["Room 04", "Legal visit", "4 seats", "Active"]] : tab === "Devices" ? [["Kiosk 02", "Room 01", "Camera + microphone", "Online"], ["Kiosk 04", "Room 03", "Heartbeat missed", "Attention"], ["Kiosk 06", "Unassigned", "Camera + microphone", "Online"]] : [[tab, "Configured rule", "Owner · Supervisor", "Active"], ["Visitor identity", "Required before check-in", "Owner · Verification", "Active"], ["Recording policy", "Per appointment type", "Owner · Compliance", "Active"]]).map((row) => <button key={row[0]} onClick={() => onNotify(`${row[0]} configuration opened.`)}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><Status tone={row[3] === "Attention" ? "red" : "green"}>{row[3]}</Status><b>→</b></button>)}</div>}</section></div></>;
}

function AdministrationPage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Staff");
  return <><PageHeader eyebrow="Management · Administration" title="Administration" description="Make roles, notifications, integrations, and system defaults understandable to the people who own them." actions={<Button variant="primary" onClick={() => onNotify("Administration changes are ready for review.")}>Save changes</Button>} /><div className="sv3-admin-tabs">{["Staff", "Roles & Permissions", "Notifications", "Integrations", "System Settings"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "Staff" ? <div className="sv3-admin-content"><div className="sv3-admin-stat"><span>Provisioned staff</span><strong>8</strong><small>All facility scoped</small></div><div className="sv3-staff-list">{[["Maya Santoso", "Scheduling Officer", "Last login · 09:12", "MS"], ["Rahman Prakoso", "Supervisor", "Last login · 08:42", "RP"], ["Dewi Lestari", "Verification Officer", "Last login · 08:30", "DL"], ["Arif Nugraha", "Monitoring Officer", "Last login · yesterday", "AN"]].map((staff) => <button key={staff[0]} onClick={() => onNotify(`${staff[0]} profile opened.`)}><Avatar initials={staff[3]} tone="blue" /><span><strong>{staff[0]}</strong><small>{staff[1]} · Central Facility</small></span><span>{staff[2]}</span><Status tone="green">ACTIVE</Status><b>→</b></button>)}</div></div> : tab === "Roles & Permissions" ? <div className="sv3-permissions"><div className="sv3-permission-head"><span>PERMISSION</span><span>Scheduler</span><span>Monitor</span><span>Finance</span><span>Supervisor</span></div>{[["Appointment approve", "✓", "—", "—", "✓"], ["Session monitor", "—", "✓", "—", "✓"], ["Credit adjustment", "—", "—", "✓", "✓"], ["Facility lockdown", "—", "—", "—", "✓"], ["Recording access", "—", "✓", "—", "✓"]].map((row) => <div className="sv3-permission-row" key={row[0]}>{row.map((cell, index) => <span className={index > 0 && cell === "✓" ? "allowed" : ""} key={`${row[0]}-${index}`}>{cell}</span>)}</div>)}<p>Permissions are provisioned by institutional administrators. This demo role cannot elevate itself.</p></div> : <div className="sv3-admin-settings">{["Visitor reminders", "Security event alerts", "Weekly reconciliation report", "Break-glass access approval"].map((setting, index) => <div className="sv3-setting-row" key={setting}><div><strong>{setting}</strong><small>{index === 3 ? "Require supervisor and reason before sensitive access." : "Notify the assigned facility team when this event changes."}</small></div><label className="sv3-switch"><input type="checkbox" defaultChecked={index !== 2} onChange={() => onNotify(`${setting} setting updated.`)} /><i /></label></div>)}<Button variant="primary" onClick={() => onNotify(`${tab} settings saved.`, "success")}>Save {tab.toLowerCase()}</Button></div>}</>;
}
