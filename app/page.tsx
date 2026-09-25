"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import KioskCredentialManager from "./components/KioskCredentialManager";
import PrisonerDirectory from "./components/PrisonerDirectory";
import VisitPolicyEditor from "./components/VisitPolicyEditor";
import StaffObserverClient from "./features/live-session/StaffObserverClient";

type Mode = "operations" | "management";
type RuntimeEnvironment = "development" | "staging" | "production" | "unknown";
type AppointmentStatus = "Requires action" | "Ready" | "Live" | "Blocked" | "Completed" | "Approved";
type WaitingState = "NOT_ARRIVED" | "VISITOR_WAITING" | "PRISONER_WAITING" | "BOTH_PRESENT" | "TECHNICAL_ISSUE" | "STAFF_REVIEW" | "READY_TO_START" | "LATE" | "LIVE" | "COMPLETED" | "NO_SHOW";
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
  backendVersion?: number;
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
  rawStatus?: string;
  version?: number;
  requestedStart?: string;
  requestedEnd?: string;
  relationshipType?: string | null;
  relationshipStatus?: string | null;
  prisonerStatus?: string | null;
  visitationStatus?: string | null;
  facilityState?: string | null;
  availableCredits?: number;
  reservedCredits?: number;
  activeCreditReservation?: boolean;
  createdAt?: string;
  updatedAt?: string;
  issue?: string;
};
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

type Notice = { id: number; message: string; tone?: "success" | "warning" | "error" | "info" };
type AuditEvent = {
  id: string;
  actionType: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  actorRole: string | null;
  correlationId: string;
  createdAt: string;
};
type StaffShellIdentity = { displayName?: string; userType?: string; scope?: { facilityName?: string; jobTitle?: string } | null };
type CommandWaitingVisit = { id: string; visitor_name?: string | null; prisoner_name?: string | null; state?: string | null; readiness?: { state?: string | null } };
type CommandLiveSession = { id: string; appointment_id: string; status: string; visitor_name?: string | null; prisoner_name?: string | null; room_name?: string | null; kiosk_name?: string | null; participants?: Array<{ participant_role?: string; status?: string }> };
type ResourceReassignment = { appointmentId: string; sourceResourceId: string; targetResourceId: string; expectedSourceVersion: number; expectedTargetVersion: number; expectedWaitingVersion: number; reason: string };
type PopoverKind = "capacity" | "waiting" | "session" | "demo" | null;
type DrawerPayload =
  | { kind: "appointment"; appointment: Appointment }
  | { kind: "device"; device: string }
  | { kind: "waiting"; visitor: string }
  | { kind: "incident"; id: string }
  | { kind: "activity"; event: string; source: string; relatedId: string };
type DrawerInput = DrawerPayload | { kind: "appointment" | "activity"; appointment?: Appointment; event?: string; source?: string; relatedId?: string };

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

function mapBackendAppointment(row: { id: string; visitor_name?: string; prisoner_name?: string; requested_start: string; requested_end: string; timezone?: string | null; appointment_type?: string; status: string; version?: number; created_at?: string; updated_at?: string; room_name?: string | null; kiosk_name?: string | null; relationship_type?: string | null; relationship_status?: string | null; prisoner_status?: string | null; visitation_status?: string | null; facility_state?: string | null; available_credits?: number; reserved_credits?: number; active_credit_reservation?: number }): Appointment {
  const start = new Date(row.requested_start);
  const end = new Date(row.requested_end);
  const status: AppointmentStatus = row.status === "APPROVED" ? "Approved" : row.status === "WAITING" ? "Ready" : row.status === "IN_PROGRESS" ? "Live" : row.status === "COMPLETED" ? "Completed" : ["REJECTED", "CANCELLED_BY_FACILITY", "CANCELLED_BY_VISITOR", "FAILED", "NO_SHOW"].includes(row.status) ? "Blocked" : ["SUBMITTED", "UNDER_REVIEW"].includes(row.status) ? "Requires action" : "Ready";
  const visitor = row.visitor_name || "Visitor name unavailable";
  const prisoner = row.prisoner_name || "Prisoner name unavailable";
  const timeZone = row.timezone || "Asia/Jakarta";
  const time = (value: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(value);
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone }).format(start);
  return { id: row.id, visitor, visitorInitials: visitor.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), prisoner, time: `${time(start)}–${time(end)}`, date, room: row.room_name || "Unassigned", kiosk: row.kiosk_name || "Unassigned", type: row.appointment_type === "LEGAL" ? "Legal" : "Family", status, rawStatus: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, requestedStart: row.requested_start, requestedEnd: row.requested_end, relationshipType: row.relationship_type, relationshipStatus: row.relationship_status, prisonerStatus: row.prisoner_status, visitationStatus: row.visitation_status, facilityState: row.facility_state, availableCredits: row.available_credits, reservedCredits: row.reserved_credits, activeCreditReservation: row.active_credit_reservation === 1, issue: status === "Requires action" ? "Visitor request awaits staff review" : undefined };
}

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

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: ReactNode; actions?: ReactNode }) {
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
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("operations");
  const [page, setPage] = useState("Command Center");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [facilityState, setFacilityState] = useState("NORMAL_OPERATIONS");
  const [facilityVersion, setFacilityVersion] = useState(1);
  const [facilityName, setFacilityName] = useState("Facility workspace");
  const [facilityTimezone, setFacilityTimezone] = useState("Asia/Jakarta");
  const [backendStatus, setBackendStatus] = useState<"connected" | "unavailable">("unavailable");
  const [runtimeEnvironment, setRuntimeEnvironment] = useState<RuntimeEnvironment>("unknown");
  const [simulationPaused, setSimulationPaused] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedDrawer, setSelectedDrawer] = useState<DrawerPayload | null>(null);
  const [approvalAppointment, setApprovalAppointment] = useState<Appointment | null>(null);
  const [popover, setPopover] = useState<PopoverKind>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [simulationTick, setSimulationTick] = useState(0);
  const [staffIdentity, setStaffIdentity] = useState<StaffShellIdentity | null>(null);
  const [now, setNow] = useState(() => new Date());

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
    fetch("/api/auth/me", { headers: { accept: "application/json" }, credentials: "include", cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { identity?: StaffShellIdentity };
      if (active && body.identity) setStaffIdentity(body.identity);
    }).catch(() => undefined);
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/health/readiness", { headers: { accept: "application/json" }, cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { environment?: RuntimeEnvironment };
      if (!active) return;
      const environment = body.environment;
      setRuntimeEnvironment(environment === "development" || environment === "staging" || environment === "production" ? environment : "unknown");
    }).catch(() => { if (active) setRuntimeEnvironment("unknown"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/control/appointments", { headers: { accept: "application/json" }, credentials: "include" }).then(async (response) => {
      if (!active || !response.ok) return;
      const body = await response.json() as { appointments?: Array<{ id: string; visitor_name?: string; prisoner_name?: string; requested_start: string; requested_end: string; timezone?: string | null; appointment_type?: string; status: string; version?: number; room_name?: string | null; kiosk_name?: string | null; relationship_type?: string | null; relationship_status?: string | null; prisoner_status?: string | null; visitation_status?: string | null; facility_state?: string | null; available_credits?: number; reserved_credits?: number; active_credit_reservation?: number }> };
      if (body.appointments) {
        setAppointments(body.appointments.map(mapBackendAppointment));
        setBackendStatus("connected");
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/facility/state", { headers: { accept: "application/json" } }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { facility?: { name?: string; timezone?: string; currentState: string; version: number } };
      if (active && body.facility) {
        setFacilityName(body.facility.name || "Facility workspace");
        setFacilityTimezone(body.facility.timezone || "Asia/Jakarta");
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

  async function changeFacilityState(nextState: string, reason?: string) {
    const previousState = facilityState;
    try {
      const response = await fetch("/api/facility/state", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `facility-state:${nextState}:${facilityVersion}:${crypto.randomUUID()}` }, body: JSON.stringify({ state: nextState, expectedVersion: facilityVersion, reason: reason || (nextState === "LOCKDOWN" ? "Staff supervisor declared a controlled facility lockdown." : "Staff supervisor restored normal operations.") }) });
      if (response.ok) {
        const body = await response.json() as { facility?: { version?: number } };
        setFacilityState(nextState);
        setFacilityVersion(body.facility?.version || facilityVersion + 1);
        setBackendStatus("connected");
        notify(nextState === "LOCKDOWN" ? "Facility lockdown declared and audit event created." : "Facility returned to normal operations.", nextState === "LOCKDOWN" ? "warning" : "success");
      } else {
        notify("The facility state was not changed because the protected staff API rejected the request.", "error");
      }
    } catch {
      notify("The facility state was not changed because the protected staff API is unavailable.", "error");
    }
    if (previousState === nextState) notify("No facility state change was needed.");
  }

  async function updateAppointment(id: string, status: AppointmentStatus, commandOverride?: "approve" | "reject" | "request_info" | "cancel" | "no_show") {
    const command = commandOverride || (status === "Approved" ? "approve" : status === "Blocked" ? "reject" : "request_info");
    try {
      const appointment = appointments.find((item) => item.id === id);
      if (!appointment || !Number.isSafeInteger(appointment.version)) throw new Error("APPOINTMENT_VERSION_UNAVAILABLE");
      const response = await fetch("/api/control/appointments", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `appointment-decision-${id}-${command}-${appointment.version}-${crypto.randomUUID()}` }, credentials: "include", body: JSON.stringify({ appointmentId: id, command, expectedVersion: appointment.version, reason: `Staff selected ${command.replaceAll("_", " ")} from the appointment review workflow.` }) });
      const body = await response.json() as { status?: string; error?: string; version?: number; idempotent?: boolean; allocation?: { roomName?: string; deviceName?: string } | null };
      if (!response.ok) throw new Error(body.error || "APPOINTMENT_DECISION_FAILED");
      setBackendStatus("connected");
      const statusByCode: Record<string, AppointmentStatus> = { APPROVED: "Approved", REJECTED: "Blocked", UNDER_REVIEW: "Requires action", CANCELLED_BY_FACILITY: "Blocked" };
      setAppointments((current) => current.map((item) => item.id === id ? { ...item, status: statusByCode[body.status || ""] || item.status, rawStatus: body.status || item.rawStatus, version: body.version ?? (body.idempotent ? item.version : (item.version || 0) + 1), room: body.allocation?.roomName || item.room, kiosk: body.allocation?.deviceName || item.kiosk, activeCreditReservation: body.status === "APPROVED" ? true : item.activeCreditReservation, availableCredits: body.status === "APPROVED" && !item.activeCreditReservation ? Math.max(0, (item.availableCredits || 0) - 1) : item.availableCredits, issue: undefined } : item));
      notify(status === "Approved" ? "Visit approved and persisted to the facility workflow." : `Visit decision persisted as ${command.replaceAll("_", " ")}.`, status === "Approved" ? "success" : "warning");
      setSelectedAppointment(null);
      setApprovalAppointment(null);
    } catch (error) {
      const code = error instanceof Error ? error.message : "APPOINTMENT_DECISION_FAILED";
      const message = code === "STALE_APPOINTMENT" ? "This appointment changed since it was opened. Refresh the queue before deciding." : code === "APPOINTMENT_VERSION_UNAVAILABLE" ? "This appointment cannot be changed because its persisted version is unavailable. Refresh the queue and select a saved appointment." : code === "AUTHENTICATION_REQUIRED" || code === "PERMISSION_DENIED" ? "Your staff session does not have permission to change this appointment." : "The decision was not saved. No local status change was made.";
      notify(message, "error");
    }
  }

  async function reassignAppointment(input: ResourceReassignment) {
    const response = await fetch("/api/control/resources", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "include", body: JSON.stringify({
      resourceId: input.sourceResourceId,
      command: "reassign_appointment",
      appointmentId: input.appointmentId,
      targetResourceId: input.targetResourceId,
      expectedVersion: input.expectedSourceVersion,
      expectedTargetVersion: input.expectedTargetVersion,
      expectedWaitingVersion: input.expectedWaitingVersion,
      reason: input.reason,
    }) });
    const body = await response.json() as { error?: string; resourceType?: "ROOM" | "DEVICE"; displayName?: string; version?: number };
    if (!response.ok) throw new Error(body.error || "RESOURCE_REASSIGNMENT_FAILED");
    setBackendStatus("connected");
    setAppointments((current) => current.map((item) => item.id === input.appointmentId ? {
      ...item,
      room: body.resourceType === "ROOM" ? body.displayName || item.room : item.room,
      kiosk: body.resourceType === "DEVICE" ? body.displayName || item.kiosk : item.kiosk,
    } : item));
    notify(`${body.displayName || "Resource"} assigned to ${input.appointmentId}.`, "success");
  }

  function openDrawer(payload: DrawerInput) {
    if (payload.kind === "appointment") {
      if (!payload.appointment) return;
      setSelectedDrawer({ kind: "appointment", appointment: payload.appointment });
      return;
    }
    if (payload.kind === "activity") {
      const { event, source, relatedId } = payload;
      if (!event || !source || !relatedId) return;
      if (relatedId.startsWith("SV-")) {
        const appointment = appointments.find((item) => item.id === relatedId);
        if (appointment) {
          setSelectedDrawer({ kind: "appointment", appointment });
          return;
        }
      }
      setSelectedDrawer({ kind: "activity", event, source, relatedId });
      return;
    }
    if (payload.kind === "device") setSelectedDrawer({ kind: "device", device: payload.device });
    else if (payload.kind === "waiting") setSelectedDrawer({ kind: "waiting", visitor: payload.visitor });
    else if (payload.kind === "incident") setSelectedDrawer({ kind: "incident", id: payload.id });
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
    if (page === "Waiting Room") return <WaitingRoomPage facilityState={facilityState} onNotify={notify} />;
    if (page === "Live Sessions") return <LiveSessionsPage onNotify={notify} />;
    if (page === "Resources") return <ResourcesPage onNotify={notify} onReassign={reassignAppointment} />;
    if (page === "Incidents") return <IncidentsPage onNotify={notify} />;
    return <CommandCenterPage appointments={appointments} facilityName={facilityName} facilityTimezone={facilityTimezone} now={now} facilityState={facilityState} backendStatus={backendStatus} demoMode={runtimeEnvironment === "development"} simulationPaused={simulationPaused} simulationTick={simulationTick} onFacilityStateChange={changeFacilityState} onPause={() => setSimulationPaused((current) => !current)} onAdvance={() => { setSimulationTick((current) => current + 1); notify("Development simulation advanced locally; no facility record changed.", "info"); }} onNavigate={navigate} onOpenDrawer={openDrawer} onOpenAppointment={setSelectedAppointment} onOpenPopover={(kind) => setPopover((current) => current === kind ? null : kind)} onNotify={notify} popover={popover} />;
  }

  function renderManagementPage() {
    if (page === "People") return <PeoplePage onNotify={notify} />;
    if (page === "Visitation") return <VisitationPage />;
    if (page === "Finance") return <FinancePage onNotify={notify} />;
    if (page === "Compliance") return <CompliancePageInteractive onNotify={notify} />;
    if (page === "Facility") return <FacilityPage facilityState={facilityState} onNotify={notify} />;
    return <RealAdministrationPage onNotify={notify} />;
  }

  return <div className="sv3-app sv6-control-app">
    <aside className="sv3-sidebar">
      <div className="sv3-brand"><SecureVisitLogo /></div>
      <div className="sv3-facility-chip"><span className="sv3-facility-icon">▣</span><div><strong>{staffIdentity?.scope?.facilityName || "Facility workspace"}</strong><small>{staffIdentity?.scope?.facilityName ? "Protected facility" : "Awaiting staff scope"}</small></div><span>⌄</span></div>
      <div className="sv3-mode-switch" role="tablist" aria-label="Staff workspace"><button className={mode === "operations" ? "active" : ""} onClick={() => navigate("Command Center", "operations")}>Operations</button><button className={mode === "management" ? "active" : ""} onClick={() => navigate("People", "management")}>Management</button></div>
      <SectionLabel>{mode === "operations" ? "Live operations" : "Records & policy"}</SectionLabel>
      <nav className="sv3-nav" aria-label={`${mode} navigation`}>{currentNav.map(([label, icon]) => <button key={label} className={page === label ? "active" : ""} onClick={() => navigate(label)}><span>{icon}</span><b>{label}</b>{label === "Appointments" && appointments.filter((appointment) => appointment.status !== "Completed").length > 0 ? <em>{appointments.filter((appointment) => appointment.status !== "Completed").length}</em> : label === "Waiting Room" && appointments.filter((appointment) => appointment.status === "Ready").length > 0 ? <em>{appointments.filter((appointment) => appointment.status === "Ready").length}</em> : null}</button>)}</nav>
      <div className="sv3-sidebar-foot"><div className="sv3-connection"><span className={backendStatus === "connected" ? "online" : "demo"} />{backendStatus === "connected" ? "Protected API connected" : "Protected API unavailable"}</div><button className="sv3-user"><Avatar initials={(staffIdentity?.displayName || "Staff").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()} tone="orange" /><span><strong>{staffIdentity?.displayName || "Staff session"}</strong><small>{staffIdentity?.scope?.jobTitle || "Facility operator"}</small></span><span>···</span></button></div>
    </aside>
    <main className="sv3-main">
      <div className="sv3-topbar"><div className="sv3-breadcrumb"><span>SecureVisit Control</span><i>/</i><strong>{mode === "operations" ? "Operations" : "Management"}</strong><i>/</i><strong>{page}</strong></div><div className="sv3-top-actions"><button type="button" className="sv3-demo-badge" aria-label={`Runtime environment: ${runtimeEnvironment}`} onClick={() => runtimeEnvironment === "development" && setPopover(popover === "demo" ? null : "demo")}><i />{runtimeEnvironment === "unknown" ? "CHECKING ENVIRONMENT" : `${runtimeEnvironment.toUpperCase()} ENVIRONMENT`}</button><span className="sv3-clock" suppressHydrationWarning>{new Intl.DateTimeFormat("en-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(now)} WIB</span><button className="sv3-icon-button" aria-label="Open command palette" onClick={() => setCommandOpen(true)}>⌕</button><button className="sv3-visitor-link" aria-label="Open Visitor Portal" onClick={() => router.push("/visitor")}><span>↗</span> Visitor Portal</button><button className="sv3-icon-button" aria-label="Notifications" onClick={() => notify("No new security notifications.")}>◔</button></div></div>
      <div className="sv3-page-scroll">{pageContent}</div>
    </main>
    {runtimeEnvironment === "development" && popover === "demo" ? <div className="sv3-top-popover"><span className="sv3-eyebrow">Development environment</span><strong>Local simulation controls are enabled</strong><span>Scenario · Normal day</span><span>Simulation · {simulationPaused ? "Paused" : "Running"}</span><Button variant="quiet" onClick={() => { setPopover(null); notify("Development simulation reset. No facility record changed."); }}>Reset simulation</Button></div> : null}
    <div className="sv3-toasts" aria-live="polite">{notices.map((notice) => <div key={notice.id} className={`sv3-toast sv3-toast-${notice.tone || "info"}`} role="status"><i>{notice.tone === "error" ? "×" : notice.tone === "warning" ? "!" : notice.tone === "success" ? "✓" : "•"}</i><span>{notice.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}>×</button></div>)}</div>
    {selectedAppointment ? <AppointmentDrawer appointment={selectedAppointment} onClose={() => setSelectedAppointment(null)} onRequestApproval={() => setApprovalAppointment(selectedAppointment)} onUpdate={updateAppointment} /> : null}
    {selectedDrawer ? <ContextDrawer payload={selectedDrawer} onClose={() => setSelectedDrawer(null)} onOpenAppointment={(appointment) => { setSelectedDrawer(null); setSelectedAppointment(appointment); }} onRequestApproval={(appointment) => { setSelectedDrawer(null); setApprovalAppointment(appointment); }} onReassign={reassignAppointment} onNotify={notify} /> : null}
    {approvalAppointment ? <ImpactDialog appointment={approvalAppointment} onClose={() => setApprovalAppointment(null)} onConfirm={() => updateAppointment(approvalAppointment.id, "Approved")} /> : null}
    {commandOpen ? <CommandPalette appointments={appointments} onClose={() => setCommandOpen(false)} onOpenAppointment={(appointment) => { setCommandOpen(false); setSelectedAppointment(appointment); }} onNavigate={(nextPage) => { setCommandOpen(false); navigate(nextPage); }} /> : null}
  </div>;
}

function CommandCenterPage({ appointments, facilityName, facilityTimezone, now, facilityState, backendStatus, demoMode, simulationPaused, simulationTick, onFacilityStateChange, onPause, onAdvance, onNavigate, onOpenDrawer, onOpenAppointment, onOpenPopover, onNotify, popover }: { appointments: Appointment[]; facilityName: string; facilityTimezone: string; now: Date; facilityState: string; backendStatus: "connected" | "unavailable"; demoMode: boolean; simulationPaused: boolean; simulationTick: number; onFacilityStateChange: (state: string, reason?: string) => void; onPause: () => void; onAdvance: () => void; onNavigate: (page: string) => void; onOpenDrawer: (payload: DrawerInput) => void; onOpenAppointment: (appointment: Appointment) => void; onOpenPopover: (kind: Exclude<PopoverKind, null>) => void; onNotify: (message: string, tone?: Notice["tone"]) => void; popover: PopoverKind }) {
  const lockdown = facilityState === "LOCKDOWN";
  const [lockdownDialog, setLockdownDialog] = useState(false);
  const [propagating, setPropagating] = useState(false);
  const [scenario, setScenario] = useState("Normal day");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState(false);
  const [resources, setResources] = useState<ResourceApiRow[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [waitingVisits, setWaitingVisits] = useState<CommandWaitingVisit[]>([]);
  const [waitingLoading, setWaitingLoading] = useState(true);
  const [liveSessions, setLiveSessions] = useState<CommandLiveSession[]>([]);
  const [liveSessionsLoading, setLiveSessionsLoading] = useState(true);
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
        const body = await response.json() as { sessions?: CommandLiveSession[] };
        if (active) setLiveSessions(Array.isArray(body.sessions) ? body.sessions : []);
      } catch {
        if (active) setLiveSessions([]);
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
        const body = await response.json() as { visits?: CommandWaitingVisit[] };
        if (active) setWaitingVisits(Array.isArray(body.visits) ? body.visits : []);
      } catch {
        if (active) setWaitingVisits([]);
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
        if (active) setResources(Array.isArray(body.resources) ? body.resources : []);
      } catch {
        if (active) setResources([]);
      } finally {
        if (active) setResourcesLoading(false);
      }
    };
    void loadResources();
    const timer = window.setInterval(loadResources, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const blocked = appointments.filter((appointment) => appointment.status === "Blocked");
  const attention = appointments.filter((appointment) => appointment.status === "Requires action" || appointment.status === "Blocked").length + (lockdown ? 1 : 0);
  const rooms = resources.filter((resource) => resource.resource_type === "ROOM");
  const occupiedRooms = rooms.filter((resource) => resource.active_appointment_id || resource.status === "IN_USE").length;
  const roomCapacity = resourcesLoading ? "—" : `${occupiedRooms} / ${rooms.length}`;
  const waitingNow = waitingVisits.filter((visit) => ["VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT"].includes(visit.state || visit.readiness?.state || "")).length;
  const activeSessions = lockdown ? [] : liveSessions;
  const upcomingVisits = appointments.filter((appointment) => !["Completed", "Blocked"].includes(appointment.status)).length;
  const waitingVisitors = waitingVisits.filter((visit) => ["VISITOR_WAITING", "BOTH_PRESENT", "READY_TO_START"].includes(visit.state || visit.readiness?.state || "")).length;
  const activeKiosks = resources.filter((resource) => resource.resource_type === "DEVICE" && (resource.active_appointment_id || resource.status === "IN_USE")).length;
  const operationalDataUnavailable = backendStatus !== "connected";
  const operationalRecordLabel = operationalDataUnavailable ? "Persisted visit data unavailable" : `${appointments.length} persisted record${appointments.length === 1 ? "" : "s"} · sorted by time and urgency`;
  const lockdownStats = [
    `${operationalDataUnavailable ? "Unknown" : upcomingVisits} upcoming visits require review`,
    `${operationalDataUnavailable ? "Unknown" : waitingVisitors} visitors currently waiting`,
    `${resourcesLoading || operationalDataUnavailable ? "Unknown" : occupiedRooms} rooms currently in use`,
    `${resourcesLoading || operationalDataUnavailable ? "Unknown" : activeKiosks} kiosks currently in use`,
  ];
  const nextDecision = appointments.find((appointment) => appointment.status === "Requires action") || appointments.find((appointment) => appointment.status === "Ready");
  const timeline = appointments.slice(0, 4).map((appointment, index) => {
    const status = lockdown ? "BLOCKED" : appointment.status === "Live" ? "LIVE" : appointment.status === "Completed" ? "COMPLETED" : appointment.status === "Blocked" || appointment.status === "Requires action" ? "BLOCKED" : appointment.status === "Ready" ? "READY" : "APPROVED";
    const tone = status === "COMPLETED" ? "green" : status === "LIVE" ? "orange" : status === "BLOCKED" ? "red" : "blue";
    const line = status === "COMPLETED" ? "done" : status === "LIVE" ? "live" : status === "BLOCKED" ? "blocked" : "ready";
    const meta = lockdown ? "Cancelled by facility lockdown · resource state updated" : `${appointment.room} · ${appointment.type} visit${appointment.issue ? ` · ${appointment.issue}` : ""}`;
    return { time: appointment.time.split("–")[0], status, tone, line, title: `${appointment.visitor} ↔ ${appointment.prisoner}`, meta, appointment, action: status === "LIVE" ? "Monitor" : status === "COMPLETED" ? "View details" : status === "BLOCKED" ? "Resolve" : index === 0 ? "Review" : "Open" };
  });

  function confirmLockdown(reason: string, details: string) {
    setLockdownDialog(false);
    setPropagating(true);
    onFacilityStateChange("LOCKDOWN", `${reason}: ${details}`);
    onNotify("Facility response recorded. Approvals are suspended while staff review affected visits.", "warning");
    window.setTimeout(() => { setPropagating(false); onNotify("Lockdown active. Affected visits remain available for staff review.", "warning"); }, 1300);
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
    <div className={`sv3-command-band sv6-command-hero ${lockdown ? "sv3-command-band-lockdown" : ""} ${propagating ? "sv3-state-propagating" : ""}`}><div><span className="sv3-eyebrow">{facilityName} · Operations</span><h1>{lockdown ? "Facility lockdown" : "Command Center"}</h1><p>{lockdown ? "New visit approvals are suspended while the facility response is active." : "Live operations across today&apos;s visitation program."}</p><div className="sv6-hero-meta"><span><i className="sv6-pulse-dot" />{backendStatusLabel(lockdown, backendStatus)}</span><span>Facility time <b suppressHydrationWarning>{new Intl.DateTimeFormat("en-ID", { hour: "2-digit", minute: "2-digit", timeZone: facilityTimezone }).format(now)}</b></span></div></div><div className="sv3-command-state"><Status tone={lockdown ? "red" : backendStatus === "connected" ? "green" : "orange"}>{lockdown ? "FACILITY LOCKDOWN" : backendStatus === "connected" ? "NORMAL OPERATIONS" : "API UNAVAILABLE"}</Status><strong suppressHydrationWarning>{new Intl.DateTimeFormat("en-ID", { hour: "2-digit", minute: "2-digit", timeZone: facilityTimezone }).format(now)}</strong><small>{facilityTimezone}</small></div></div>
    {lockdown ? <div className="sv3-lockdown-strip"><strong>Operational response active</strong><span>Approvals suspended · {upcomingVisits} visits require review · {waitingVisitors} visitors waiting · no automatic credit settlement</span></div> : null}
    <div className="sv3-command-metrics sv6-command-metrics"><Metric label="Live sessions" value={liveSessionsLoading ? "—" : String(activeSessions.length)} detail={lockdown ? "Sessions ended by response" : liveSessionsLoading ? "Loading session data" : "Persisted active sessions"} tone="orange" onClick={() => onOpenPopover("session")} /><Metric label="Waiting room" value={waitingLoading ? "—" : String(waitingNow)} detail={lockdown ? "Waiting room closed" : waitingLoading ? "Loading readiness data" : "Persisted presence states"} tone="blue" onClick={() => onOpenPopover("waiting")} /><Metric label="Requires attention" value={operationalDataUnavailable ? "—" : String(attention)} detail={lockdown ? "1 response event" : operationalDataUnavailable ? "Protected appointment data unavailable" : "Persisted blockers and review"} tone="red" onClick={() => document.querySelector(".sv3-attention-surface")?.scrollIntoView({ behavior: "smooth", block: "center" })} /><Metric label="Rooms in use" value={lockdown ? "—" : roomCapacity} detail={resourcesLoading ? "Loading facility resources" : rooms.length ? `${rooms.length} rooms · live resource data` : "No room data available"} tone="green" onClick={() => onOpenPopover("capacity")} />{popover === "session" ? <SessionPopover sessions={activeSessions} loading={liveSessionsLoading} onOpen={() => onNavigate("Live Sessions")} /> : popover === "waiting" ? <WaitingPopover visits={waitingVisits} loading={waitingLoading} onOpen={() => onNavigate("Waiting Room")} /> : popover === "capacity" ? <CapacityPopover resources={resources} loading={resourcesLoading} onOpen={() => onNavigate("Resources")} /> : null}</div>
    {demoMode ? <div className="sv3-simulation-bar sv6-simulation-bar"><div className="sv6-simulation-status"><span><i className={simulationPaused ? "paused" : ""} />Development simulation</span><strong>{simulationPaused ? "Paused" : "Running"}</strong></div><label className="sv6-simulation-field">Scenario<select value={scenario} onChange={(event) => handleScenario(event.target.value)}><option>Normal day</option><option>Busy morning</option><option>Device failure</option><option>Visitor no-show</option><option>Facility lockdown</option><option>Technical failure</option><option>Security incident</option></select></label><span className="sv6-simulation-speed">Speed <b>1×</b></span><div className="sv6-simulation-actions"><button onClick={onPause}> {simulationPaused ? "Resume" : "Pause"}</button><button onClick={onAdvance}>Advance event</button><button onClick={() => onNotify("Scenario library is available only in the development environment.")}>Scenarios</button><button onClick={() => lockdown ? onFacilityStateChange("NORMAL_OPERATIONS") : setLockdownDialog(true)} className="danger-link">{lockdown ? "Restore facility" : "Test lockdown"}</button></div><small>Development event {String(3 + simulationTick).padStart(2, "0")} · {simulationTick ? "Local event only" : "Normal day scenario"}</small></div> : null}
    <div className="sv6-operations-label"><div><span className="sv3-eyebrow">Decision surface</span><strong>Act on the next operational moment</strong></div><span>{operationalRecordLabel}</span></div>
    <div className="sv3-command-layout"><section className="sv3-surface sv3-timeline-surface sv6-timeline-surface"><div className="sv3-surface-head"><div><span className="sv3-eyebrow" aria-label="Today&apos;s operational timeline">Operational timeline</span><h2>Persisted visits</h2></div><button className="sv3-link-button" onClick={() => onNavigate("Appointments")}>Open appointments →</button></div><div className="sv3-timeline">{timeline.length ? timeline.map((item) => <div className={`sv3-timeline-row sv3-timeline-row-interactive ${item.status === "BLOCKED" ? "timeline-blocked" : ""}`} key={item.time} role="button" tabIndex={0} onClick={() => item.appointment && onOpenAppointment(item.appointment)} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && item.appointment) { event.preventDefault(); onOpenAppointment(item.appointment); } }}><time>{item.time}</time><span className={`sv3-timeline-line ${item.line}`} /><div className="sv6-timeline-content"><div className="sv6-timeline-topline"><button type="button" className="sv3-timeline-status" onClick={(event) => { event.stopPropagation(); if (item.appointment) onOpenDrawer({ kind: item.status.includes("LIVE") ? "activity" : "appointment", ...(item.status.includes("LIVE") ? { event: `${item.appointment.visitor} ↔ ${item.appointment.prisoner}`, source: "Live session", relatedId: item.appointment.id } : { appointment: item.appointment }) }); }}><Status tone={item.tone}>{item.status}</Status></button><button type="button" className="sv6-row-action" onClick={(event) => { event.stopPropagation(); if (item.appointment) onOpenAppointment(item.appointment); }}>{item.action} <span>→</span></button></div><strong>{item.title.split(" ↔ ")[0]} {item.title.includes("↔") ? `↔ ${item.title.split(" ↔ ")[1]}` : ""}</strong><small>{item.meta}</small></div></div>) : <EmptyState title="No persisted visits loaded" body={backendStatus === "connected" ? "The facility has no appointments in this operational window." : "Connect an authenticated staff API to load the facility schedule."} action="Open appointments" />}</div></section><aside className="sv3-attention-rail"><div className="sv3-surface sv3-attention-surface sv6-attention-surface" id="action-center"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Priority queue</span><h2>Requires attention</h2></div><span className="sv3-count-badge">{attention}</span></div>{nextDecision ? <button className="sv3-action-row" onClick={() => onOpenAppointment(nextDecision)}><span className="sv3-action-icon amber">!</span><span><strong>Visit requires review</strong><small>{nextDecision.id} · staff decision pending</small></span><b>›</b><em>Review queue</em></button> : null}{blocked[0] ? <button className="sv3-action-row" onClick={() => onOpenAppointment(blocked[0])}><span className="sv3-action-icon red">×</span><span><strong>Visit is blocked</strong><small>{blocked[0].id} · {blocked[0].issue || "Operational blocker"}</small></span><b>›</b><em>Resolve</em></button> : null}{!attention ? <EmptyState title="No attention items" body={backendStatus === "connected" ? "No persisted visits currently require staff action." : "Attention items will appear after the protected API connects."} /> : null}</div><div className="sv3-surface sv3-feed-surface sv6-feed-surface"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Activity</span><h2>Operational history</h2></div></div>{auditLoading ? <EmptyState title="Loading operational history" body="Fetching the latest facility audit events." /> : auditError ? <EmptyState title="Activity feed unavailable" body="The protected audit feed could not be reached. Try again after staff access is restored." /> : auditEvents.length ? auditEvents.map((event) => <button type="button" className="sv3-feed-row sv3-feed-row-interactive" key={event.id} onClick={() => onOpenDrawer({ kind: "activity", event: formatAuditEvent(event), source: `${event.entityType} · ${event.actionType}`, relatedId: event.entityId || event.correlationId })}><time>{formatAuditTime(event.createdAt)}</time><span><strong>{formatAuditEvent(event)}</strong><small>{event.entityType}{event.entityId ? ` · ${event.entityId}` : ""} · {event.actorRole || "System"}</small></span><b>›</b></button>) : <EmptyState title="No activity recorded" body="New decisions, session events, and operational changes will appear here." />}</div></aside></div>
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

function formatAuditTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-ID", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

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

function AppointmentsPage({ appointments, onSelect, onNotify }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [view, setView] = useState("Queue");
  const [filter, setFilter] = useState("Needs decision");
  const [query, setQuery] = useState("");
  const active = appointments.filter((appointment) => appointment.status !== "Completed");
  const needsDecision = active.filter((appointment) => ["Requires action", "Ready"].includes(appointment.status));
  const blocked = active.filter((appointment) => appointment.status === "Blocked");
  const filtered = (filter === "Needs decision" ? needsDecision : filter === "Blocked" ? blocked : active).filter((appointment) => `${appointment.visitor} ${appointment.prisoner} ${appointment.id}`.toLowerCase().includes(query.toLowerCase()));
  const statusLabel = (status: AppointmentStatus) => status === "Requires action" ? "Needs review" : status === "Ready" ? "Ready to approve" : status;
  const tone = (status: AppointmentStatus) => status === "Blocked" ? "red" : status === "Requires action" ? "orange" : status === "Live" ? "green" : "blue";
  return <div className="sv7-appointments-page"><PageHeader eyebrow="Operations · Appointments" title="Appointments" description="Review persisted visit requests and make decisions against the protected facility schedule." actions={<Button variant="primary" onClick={() => needsDecision[0] ? onSelect(needsDecision[0]) : onNotify("No persisted appointment currently requires a decision.", "info")} disabled={!needsDecision.length}>Review next decision</Button>} /><div className="sv7-appointment-summary"><button className={filter === "Needs decision" ? "active" : ""} onClick={() => setFilter("Needs decision")}><b>{needsDecision.length}</b><span>Needs review</span></button><i /><button className={filter === "Blocked" ? "active" : ""} onClick={() => setFilter("Blocked")}><b>{blocked.length}</b><span>Blocked</span></button><i /><button className={filter === "All active" ? "active" : ""} onClick={() => setFilter("All active")}><b>{active.length}</b><span>All active</span></button></div><div className="sv3-workspace-tabs sv7-appointment-tabs"><button className={view === "Queue" ? "active" : ""} onClick={() => setView("Queue")}>Queue <em>{filtered.length}</em></button><button className={view === "Timeline" ? "active" : ""} onClick={() => setView("Timeline")}>Timeline <em>{active.length}</em></button><button className={view === "Calendar" ? "active" : ""} onClick={() => setView("Calendar")}>Calendar</button></div>{view === "Queue" ? <section className="sv7-queue-surface"><div className="sv7-queue-toolbar"><div className="sv7-queue-search"><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visitor, prisoner, or visit ID" /></label></div><div className="sv7-queue-meta"><span>{filtered.length} persisted records</span><button onClick={() => { setQuery(""); setFilter("All active"); }}>Clear filters</button></div></div>{filtered.length ? <div className="sv7-queue-list" role="list"><div className="sv7-queue-head" aria-hidden="true"><span>Request</span><span>Participants</span><span>Requested time</span><span>Readiness</span><span>Decision age</span><span>Status</span><span>Action</span></div>{filtered.map((appointment) => { const readiness = appointmentReadiness(appointment); return <button role="listitem" className="sv7-queue-row" key={appointment.id} onClick={() => onSelect(appointment)}><span className="sv7-request-cell"><strong>{appointment.type} visit</strong><small>{appointment.id}</small></span><span className="sv7-participant-cell"><strong>{appointment.visitor} <i>↔</i> {appointment.prisoner}</strong><small>{appointment.issue || "Persisted appointment record"}</small></span><span className="sv7-time-cell"><strong>{appointment.date}</strong><small>{appointment.time} WIB</small></span><span className={`sv7-readiness-cell ${readiness.blocked ? "warning" : "ready"}`}><strong>{readiness.blocked ? "!" : "✓"} {readiness.passed} / {readiness.total} ready</strong><small>{readiness.blocked ? "Eligibility, credit, or resources need review" : "Persisted checks are ready"}</small></span><span className="sv7-sla-cell">{appointmentDecisionAge(appointment)}</span><span><Status tone={tone(appointment.status)}>{statusLabel(appointment.status)}</Status></span><span className="sv7-row-action">Open <b>→</b></span></button>; })}</div> : <EmptyState title="No persisted appointments" body={query ? "No records match the current search." : "No appointment records are available in the current facility scope."} />}</section> : view === "Timeline" ? <TimelineView appointments={active} onSelect={onSelect} /> : <CalendarView appointments={active} onSelect={onSelect} />}</div>;
}

function TimelineView({ appointments, onSelect }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void }) {
  const [timelineFilter, setTimelineFilter] = useState("All");
  const filtered = timelineFilter === "All" ? appointments : appointments.filter((appointment) => timelineFilter === "Live" ? appointment.status === "Live" : timelineFilter === "Blocked" ? appointment.status === "Blocked" : timelineFilter === "Approved" ? ["Approved", "Ready"].includes(appointment.status) : appointment.status === "Completed");
  const dates = [...new Set(appointments.map((appointment) => appointment.date).filter(Boolean))];
  const assignedRooms = new Set(appointments.map((appointment) => appointment.room).filter((room) => room && room !== "Unassigned"));
  const dayLabel = dates.length === 1 ? dates[0] : dates.length > 1 ? `${dates[0]} – ${dates[dates.length - 1]}` : "No schedule date available";
  return <section className="sv7-timeline-surface"><div className="sv7-view-header"><div><span className="sv3-eyebrow">Persisted schedule · {dayLabel}</span><h2>Operational timeline</h2><p>{appointments.length} visits · {appointments.filter((appointment) => appointment.status === "Blocked").length} blocked · {assignedRooms.size} assigned rooms</p></div><div className="sv7-view-controls"><span className="sv7-toolbar-meta">Facility API window</span></div></div><div className="sv7-timeline-filters">{["All", "Approved", "Blocked", "Live", "Completed"].map((item) => <button className={timelineFilter === item ? "active" : ""} key={item} onClick={() => setTimelineFilter(item)}>{item}</button>)}</div><div className="sv7-vertical-timeline">{filtered.map((appointment) => <button className={`sv7-timeline-event ${appointment.status === "Completed" ? "completed" : ""}`} key={appointment.id} onClick={() => onSelect(appointment)}><time>{appointment.time.split("–")[0]}</time><span className={`sv7-timeline-node ${appointment.status === "Blocked" ? "blocked" : appointment.status === "Live" ? "live" : "ready"}`} /><span className="sv7-timeline-event-body"><span><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "blue"}>{appointment.status === "Requires action" ? "NEEDS REVIEW" : appointment.status.toUpperCase()}</Status><em>{appointment.room} · {appointment.kiosk}</em></span><strong>{appointment.visitor} ↔ {appointment.prisoner}</strong><small>{appointment.type} Visit · {appointment.issue || "All required checks passed"}</small></span><b>›</b></button>)}</div>{!filtered.length ? <EmptyState title="No visits in this timeline" body="No persisted appointments match the selected status filter." /> : null}</section>;
}

function BackendCalendarView({ appointments, onSelect }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void }) {
  return <section className="sv7-calendar-surface"><div className="sv7-view-header"><div><span className="sv3-eyebrow">Planning horizon · persisted schedule</span><h2>Schedule calendar</h2><p>Only appointments returned by the protected facility API appear here.</p></div><div className="sv7-calendar-summary"><strong>{appointments.length}</strong><span>loaded visits<br />capacity unavailable</span></div></div>{appointments.length ? <div className="sv7-vertical-timeline">{appointments.map((appointment) => <button className="sv7-timeline-event" key={appointment.id} onClick={() => onSelect(appointment)}><time>{appointment.time}</time><span className="sv7-timeline-node ready" /><span className="sv7-timeline-event-body"><span><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "blue"}>{appointment.status}</Status><em>{appointment.room} · {appointment.kiosk}</em></span><strong>{appointment.visitor} ↔ {appointment.prisoner}</strong><small>{appointment.date} · {appointment.type} Visit</small></span><b>›</b></button>)}</div> : <EmptyState title="No scheduled visits loaded" body="Connect an authenticated staff API to load the facility schedule." />}</section>;
}


function CalendarView({ appointments, onSelect }: { appointments: Appointment[]; onSelect: (appointment: Appointment) => void; onNotify?: (message: string, tone?: Notice["tone"]) => void }) {
  return <BackendCalendarView appointments={appointments} onSelect={onSelect} />;
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
    const recordedAt = row.last_checked_at ? ` · checked ${new Date(row.last_checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
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
  return { ...base, waitingState, room: row.assigned_room_name || "Unassigned", kiosk: row.assigned_kiosk_name || "Unassigned", visitorPresence: row.visitor_presence === "present" ? "present" : "absent", prisonerPresence: row.prisoner_presence === "present" ? "present" : "waiting", checks, verification: states.get("identity") || "pending", blocker: row.staff_notes || checks.find((check) => check.state === "failed" || check.state === "warning")?.detail, lastUpdated: row.last_checked_at ? `Checked ${new Date(row.last_checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not checked", backendVersion: Number(row.version || 1) };
}

function WaitingRoomPage({ facilityState, onNotify }: { facilityState: string; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [lane, setLane] = useState("all");
  const [query, setQuery] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serverVisits, setServerVisits] = useState<WaitingRoomApiRow[]>([]);
  const [lastSync, setLastSync] = useState("not synced");
  const [syncError, setSyncError] = useState("");
  async function refreshWaitingRoom() {
    const response = await fetch("/api/control/waiting-room", { headers: { accept: "application/json" }, credentials: "include" });
    if (!response.ok) throw new Error("Waiting Room data could not be refreshed from the staff API.");
    const body = await response.json() as { visits?: WaitingRoomApiRow[] };
    setServerVisits(body.visits || []);
    setLastSync(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    setSyncError("");
  }
  useEffect(() => {
    let active = true;
    const run = () => refreshWaitingRoom().catch((error) => setSyncError(error instanceof Error ? error.message : "Waiting Room data could not be refreshed."));
    run();
    const timer = window.setInterval(() => { if (active) run(); }, 15000);
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

  async function action(record: WaitingRecord, kind: "admit" | "confirm_prisoner" | "checks" | "contact" | "late" | "cancel" | "start") {
    if (kind === "start" && (!record.checks.every((check) => check.state === "pass") || facilityState !== "NORMAL_OPERATIONS")) {
      onNotify("This visit cannot start until every pre-call check passes and the facility is operating normally.", "error");
      return;
    }
    const command = ({ admit: "admit_visitor", confirm_prisoner: "confirm_prisoner_presence", checks: "run_preflight", contact: "contact_visitor", late: "mark_late", cancel: "cancel_visit", start: "start_visit" } as const)[kind];
    try {
    const response = await fetch("/api/control/waiting-room", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `waiting-room-${crypto.randomUUID()}` }, credentials: "include", body: JSON.stringify({ appointmentId: record.id, command, expectedVersion: record.backendVersion, reason: `Staff selected ${command.replaceAll("_", " ")} from the Waiting Room workflow.`, staffNotes: kind === "contact" ? "Staff contacted the assigned unit for a readiness update." : undefined }) });
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

  return <div className="sv8-waiting-page"><PageHeader eyebrow="Operations · Admission control" title="Waiting Room" description="Move approved appointments from arrival to a safe, verified handoff into Live Sessions." actions={<><Status tone={facilityState === "NORMAL_OPERATIONS" ? "green" : "red"}>{facilityState === "NORMAL_OPERATIONS" ? "ROOM OPEN" : "FACILITY REVIEW"}</Status><Button variant="primary" onClick={() => { void refreshWaitingRoom().then(() => onNotify("Readiness data refreshed from the staff API.", "success")).catch((error) => { const message = error instanceof Error ? error.message : "Refresh failed."; setSyncError(message); onNotify(message, "error"); }); }}>↻ Refresh readiness</Button></>} /><div className="sv8-summary"><button onClick={() => setLane("waiting")} className={lane === "waiting" ? "active" : ""}><span>Waiting now</span><strong>{counts.waiting}</strong><small>presence or unit confirmation</small></button><button onClick={() => setLane("ready")} className={lane === "ready" ? "active" : ""}><span>Ready to start</span><strong>{counts.ready}</strong><small>all checks passing</small></button><button onClick={() => setLane("attention")} className={lane === "attention" ? "active" : ""}><span>Needs attention</span><strong>{counts.attention}</strong><small>blockers or late arrivals</small></button><button onClick={() => setLane("upcoming")} className={lane === "upcoming" ? "active" : ""}><span>Upcoming</span><strong>{counts.upcoming}</strong><small>not yet in the window</small></button></div><section className="sv8-queue"><div className="sv8-toolbar"><label className="sv8-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visitor, prisoner, visit ID, room, or kiosk" /></label><label className="sv8-select"><span>Window</span><select aria-label="Waiting room time window"><option>Next 2 hours</option><option>Today</option><option>All approved</option></select></label><button type="button" className={`sv8-attention-toggle ${onlyAttention ? "active" : ""}`} onClick={() => setOnlyAttention((current) => !current)}>Only needs attention</button><span className="sv8-toolbar-meta">{laneRecords(lane).length} linked visits · live readiness</span></div><div className="sv8-lane-tabs"><span>VIEW</span>{[["all", "All visits"], ["ready", "Ready to start"], ["waiting", "Waiting now"], ["attention", "Needs attention"], ["upcoming", "Upcoming"]].map(([value, label]) => <button className={lane === value ? "active" : ""} key={value} onClick={() => setLane(value)}>{label}{value !== "all" ? <em>{counts[value as keyof typeof counts]}</em> : null}</button>)}</div><div className="sv8-lanes">{[["ready", "READY TO START", "green"], ["waiting", "WAITING NOW", "blue"], ["attention", "NEEDS ATTENTION", "orange"], ["upcoming", "UPCOMING", "gray"]].map(([value, label, tone]) => <section className={`sv8-lane sv8-lane-${tone}`} key={value}><header><span><i />{label}</span><strong>{laneRecords(value).length}</strong></header><div className="sv8-lane-body">{laneRecords(value).map((record) => <article className={`sv8-card ${selectedId === record.id ? "selected" : ""}`} key={record.id}><button className="sv8-card-main" onClick={() => setSelectedId(record.id)}><div className="sv8-card-top"><Avatar initials={record.visitorInitials} tone={value === "attention" ? "orange" : value === "upcoming" ? "purple" : "blue"} /><span><strong>{record.visitor}</strong><small>{record.prisoner} · <span className="sv8-mono">{record.id}</span></small></span><Status tone={record.waitingState === "READY_TO_START" ? "green" : record.waitingState === "TECHNICAL_ISSUE" ? "red" : record.waitingState === "STAFF_REVIEW" || record.waitingState === "LATE" ? "orange" : "blue"}>{record.waitingState.replaceAll("_", " ")}</Status></div><div className="sv8-card-time"><strong>{record.date} · {record.time}</strong><span>{record.countdown}</span></div><div className="sv8-card-facts"><span>Visitor <b className={record.visitorPresence === "present" ? "pass" : "pending"}>{record.visitorPresence === "present" ? "Present" : "Not arrived"}</b></span><span>Prisoner <b className={record.prisonerPresence === "present" ? "pass" : "pending"}>{record.prisonerPresence === "present" ? "Present" : "Waiting"}</b></span><span>Resource <b>{record.room} · {record.kiosk}</b></span></div>{record.blocker ? <p className="sv8-blocker"><b>Blocker</b>{record.blocker}</p> : null}</button><div className="sv8-card-actions"><Button variant={primaryAction(record)[0] === "start" ? "primary" : "secondary"} onClick={() => action(record, primaryAction(record)[0])}>{primaryAction(record)[1]}</Button><button type="button" className="sv8-open-link" onClick={() => setSelectedId(record.id)}>Open readiness →</button></div></article>)}{!laneRecords(value).length ? <div className="sv8-lane-empty">No linked visits in this lane.</div> : null}</div></section>)}</div><footer className="sv8-footer"><span>Linked to the approved appointment queue · refreshes every 15 seconds in production.</span><strong>{syncError || `Last sync · ${lastSync}`}</strong></footer></section>{selected ? <div className="sv8-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}><aside className="sv8-drawer" role="dialog" aria-modal="true" aria-labelledby="waiting-drawer-title"><header className="sv8-drawer-head"><div><span className="sv8-kicker">{selected.id} · READINESS RECORD</span><h2 id="waiting-drawer-title">{selected.visitor}</h2><p>{selected.prisoner} · {selected.type} visit</p></div><button type="button" aria-label="Close readiness drawer" onClick={() => setSelectedId(null)}>×</button></header><div className="sv8-drawer-scroll"><div className="sv8-drawer-hero"><Avatar initials={selected.visitorInitials} tone="orange" /><div><strong>{selected.date} · {selected.time}</strong><small>{selected.room} · {selected.kiosk}</small></div><Status tone={selected.waitingState === "READY_TO_START" ? "green" : selected.waitingState === "TECHNICAL_ISSUE" ? "red" : "orange"}>{selected.waitingState.replaceAll("_", " ")}</Status></div><div className="sv8-drawer-callout"><span className="sv8-kicker">NEXT DECISION</span><strong>{selected.waitingState === "READY_TO_START" ? "Safe to start" : selected.blocker || "Waiting for arrival and facility confirmation"}</strong><p>{selected.waitingState === "READY_TO_START" ? "All required checks are passing. Starting this visit will hand it to the Live Sessions workspace." : "Resolve the highlighted blocker before starting the visit."}</p></div><section className="sv8-drawer-section"><header><span className="sv8-kicker">PRESENCE</span><span className="sv8-mono">{selected.countdown}</span></header><div className="sv8-presence-grid"><div><span>Visitor</span><strong className={selected.visitorPresence === "present" ? "pass" : "pending"}>{selected.visitorPresence === "present" ? "Present" : "Not arrived"}</strong></div><div><span>Prisoner</span><strong className={selected.prisonerPresence === "present" ? "pass" : "pending"}>{selected.prisonerPresence === "present" ? "Present" : "Waiting"}</strong></div></div></section><section className="sv8-drawer-section"><header><span className="sv8-kicker">PRE-CALL CHECKS</span><span className="sv8-check-score">{selected.checks.filter((check) => check.state === "pass").length}/{selected.checks.length} passing</span></header><div className="sv8-check-list">{selected.checks.map((check) => <div className="sv8-check-row" key={check.key}><span className={`sv8-check-icon ${check.state}`}>{check.state === "pass" ? "✓" : check.state === "failed" ? "×" : check.state === "warning" ? "!" : "·"}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div></section><section className="sv8-drawer-section"><header><span className="sv8-kicker">ASSIGNMENT</span></header><div className="sv8-detail-grid"><span><small>Room</small><strong>{selected.room}</strong></span><span><small>Kiosk</small><strong>{selected.kiosk}</strong></span><span><small>Visit ID</small><strong className="sv8-mono">{selected.id}</strong></span><span><small>Updated</small><strong>{selected.lastUpdated}</strong></span></div></section><section className="sv8-drawer-section"><header><span className="sv8-kicker">STAFF NOTES</span></header><p className="sv8-notes">{selected.issue || "No staff notes. Session is linked to the approved appointment and its reserved resources."}</p></section></div><footer className="sv8-drawer-actions"><Button variant="quiet" onClick={() => action(selected, "cancel")}>Cancel visit</Button><Button onClick={() => action(selected, "late")}>Mark late</Button><Button variant="primary" onClick={() => action(selected, primaryAction(selected)[0])} disabled={primaryAction(selected)[0] === "start" && selected.checks.some((check) => check.state !== "pass")}>{primaryAction(selected)[1]}</Button></footer></aside></div> : null}</div>;
}

type LiveSessionRow = {
  id: string;
  appointment_id: string;
  status: string;
  provider: string;
  authorized_start_at: string;
  authorized_end_at: string;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  recording_policy: string;
  recording_status: string;
  termination_reason: string | null;
  visitor_name: string;
  prisoner_name: string;
  prisoner_number: string;
  requested_start: string;
  requested_end: string;
  appointment_type: string;
  room_name: string | null;
  kiosk_name: string | null;
  participants: Array<{ identity: string; participant_role: string; status: string; last_seen_at: string; disconnected_at: string | null }>;
};

function LiveSessionsPage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [sessions, setSessions] = useState<LiveSessionRow[]>([]);
  const [recentlyEnded, setRecentlyEnded] = useState<LiveSessionRow[]>([]);
  const [selected, setSelected] = useState<LiveSessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [observer, setObserver] = useState<(LiveSessionRow & { token: string; serverUrl: string }) | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/control/live-sessions", { headers: { accept: "application/json" }, cache: "no-store" });
      const body = await response.json() as { sessions?: LiveSessionRow[]; recentlyEnded?: LiveSessionRow[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Live Session data could not be loaded.");
      const active = body.sessions || [];
      const ended = body.recentlyEnded || [];
      setSessions(active);
      setRecentlyEnded(ended);
      setSelected((current) => current ? active.concat(ended).find((row) => row.id === current.id) || null : null);
      setLastSync(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setSyncError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live Session data could not be loaded.";
      setSyncError(message);
      if (!quiet) onNotify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  async function endSession(session: LiveSessionRow) {
    setEnding(true);
    try {
      const response = await fetch(`/api/control/live-sessions/${session.id}/end`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `live-session-end-${crypto.randomUUID()}` },
        body: JSON.stringify({ reason: "Staff ended the authorized visit from Live Sessions." }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The session could not be ended.");
      setSelected(null);
      await refresh(true);
      onNotify("The session end was recorded. Credit settlement and resource release were processed by the server.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "The session could not be ended.", "error");
    } finally {
      setEnding(false);
    }
  }

  async function authorizeObserver(session: LiveSessionRow) {
    try {
      const response = await fetch(`/api/control/live-sessions/${session.id}/observer-token`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ reason: "Routine supervision of an authorized live visit." }),
      });
      const body = await response.json() as { error?: string; token?: string; serverUrl?: string };
      if (!response.ok) throw new Error(body.error || "Observer authorization was denied.");
      if (!body.token || !body.serverUrl) throw new Error("Observer authorization returned no connection details.");
      setObserver({ ...session, token: body.token, serverUrl: body.serverUrl });
      onNotify("Read-only observer access authorized and connected.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Observer authorization was denied.", "error");
    }
  }

  function displayTime(value: string | null) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function sessionCard(session: LiveSessionRow) {
    const active = sessions.some((item) => item.id === session.id);
    const tone = session.status === "ACTIVE" ? "green" : session.status === "RECONNECTING" ? "orange" : active ? "blue" : "gray";
    return <button className={`sv10-session-card ${selected?.id === session.id ? "selected" : ""}`} key={session.id} onClick={() => setSelected(session)}>
      <div className="sv10-card-top"><Status tone={tone}>{session.status.replaceAll("_", " ")}</Status><span>{session.appointment_type} · <span className="sv-mono">{session.id}</span></span></div>
      <div className="sv10-card-people"><Avatar initials={session.visitor_name.split(/\\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()} tone="orange" /><span>↔</span><Avatar initials={session.prisoner_name.split(/\\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()} tone="blue" /></div>
      <h2>{session.visitor_name} <span>↔</span> {session.prisoner_name}</h2>
      <p>{session.room_name || "Room not assigned"} · {session.kiosk_name || "Device not assigned"}</p>
      <div className="sv10-card-time"><strong>{displayTime(session.actual_started_at || session.authorized_start_at)}</strong><small>{active ? "started" : "session start"}</small></div>
      <div className="sv10-card-health"><span>Recording <b>{session.recording_policy === "OFF" ? "Off" : session.recording_status}</b></span><span>Provider <b>{session.provider}</b></span><span>Participants <b>{session.participants?.filter((participant) => participant.status === "CONNECTED").length || 0} connected</b></span></div>
      <span className="sv10-open">Open persisted session record <b>→</b></span>
    </button>;
  }

  const attentionCount = sessions.filter((session) => ["RECONNECTING", "ENDING", "CONNECTING"].includes(session.status)).length;
  return <div className="sv10-live-page"><PageHeader eyebrow="Operations · Authorized monitoring" title="Live Sessions" description="Facility-scoped sessions and completion records, refreshed from the session service." actions={<><span className="sv10-active-count"><i />{sessions.length} ACTIVE SESSION{sessions.length === 1 ? "" : "S"}</span><Button variant="primary" onClick={() => void refresh()}>↻ Refresh sessions</Button></>} />
    {syncError ? <div className="sv10-empty" role="alert"><strong>Session service unavailable</strong><span>{syncError} Displayed records may be stale; no demo sessions are substituted.</span></div> : null}
    <div className="sv10-live-summary"><div><span>Active now</span><strong>{sessions.length}</strong><small>persisted sessions</small></div><div><span>Needs attention</span><strong>{attentionCount}</strong><small>connecting or recovering</small></div><div><span>Recording</span><strong>{sessions.every((session) => session.recording_policy === "OFF") ? "OFF" : "POLICY"}</strong><small>server policy</small></div><div><span>Recently ended</span><strong>{recentlyEnded.length}</strong><small>last 24 hours</small></div></div>
    <div className="sv10-workspace"><section className="sv10-session-column"><div className="sv10-section-heading"><div><span className="sv9-kicker">ACTIVE SESSIONS</span><h2>In progress</h2></div><span>{lastSync ? `Updated ${lastSync}` : "Not synced"}</span></div><div className="sv10-session-grid">{loading ? <div className="sv10-empty"><strong>Loading session records…</strong></div> : sessions.length ? sessions.map(sessionCard) : <div className="sv10-empty"><strong>No active visits</strong><span>Persisted sessions started from Waiting Room will appear here.</span></div>}</div><div className="sv10-section-heading sv10-recent-heading"><div><span className="sv9-kicker">COMPLETION</span><h2>Recently ended</h2></div><span>{recentlyEnded.length} recorded</span></div><div className="sv10-session-grid sv10-recent-grid">{recentlyEnded.length ? recentlyEnded.slice(0, 6).map(sessionCard) : <div className="sv10-empty"><strong>No recent session records</strong><span>Completed and terminated sessions are retained here for 24 hours.</span></div>}</div></section><aside className="sv10-ops-rail"><span className="sv9-kicker">SESSION OPERATIONS</span><h2>Keep the call safe</h2><p>Only persisted session facts are shown. Participant connectivity and media quality appear when provider telemetry is available.</p><div className="sv10-rail-list"><div><span className="sv10-rail-icon">◉</span><span><strong>Media plane</strong><small>LiveKit session provider</small></span></div><div><span className="sv10-rail-icon">◷</span><span><strong>Timer authority</strong><small>Server-authorized visit window</small></span></div><div><span className="sv10-rail-icon">▣</span><span><strong>Recording policy</strong><small>Shown per session record</small></span></div></div></aside></div>
    {selected ? <div className="sv10-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="sv10-drawer" role="dialog" aria-modal="true" aria-labelledby="live-session-title"><header><div><span className="sv9-kicker">PERSISTED SESSION · <span className="sv-mono">{selected.id}</span></span><h2 id="live-session-title">{selected.visitor_name}</h2><p>{selected.prisoner_name} · #{selected.prisoner_number}</p></div><button aria-label="Close session details" onClick={() => setSelected(null)}>×</button></header><div className="sv10-drawer-body"><div className="sv10-drawer-state"><Status tone={selected.status === "ACTIVE" ? "green" : selected.status === "RECONNECTING" ? "orange" : "blue"}>{selected.status.replaceAll("_", " ")}</Status><span>Session times are server-recorded</span></div><section><span className="sv9-kicker">SCHEDULE & RESOURCE</span><div className="sv10-policy-row"><span>Scheduled</span><strong>{displayTime(selected.requested_start)} – {displayTime(selected.requested_end)}</strong></div><div className="sv10-policy-row"><span>Started</span><strong>{displayTime(selected.actual_started_at)}</strong></div><div className="sv10-policy-row"><span>Ended</span><strong>{displayTime(selected.actual_ended_at)}</strong></div><div className="sv10-policy-row"><span>Room / device</span><strong>{selected.room_name || "Not assigned"} · {selected.kiosk_name || "Not assigned"}</strong></div></section><section><span className="sv9-kicker">VIDEO POLICY</span><div className="sv10-policy-row"><span>Provider</span><strong>{selected.provider}</strong></div><div className="sv10-policy-row"><span>Recording</span><strong>{selected.recording_policy} · {selected.recording_status}</strong></div><div className="sv10-policy-row"><span>Termination note</span><strong>{selected.termination_reason || "None recorded"}</strong></div></section><section><span className="sv9-kicker">TELEMETRY</span><p className="sv10-event-note">Participant connectivity and media-quality telemetry are not yet exposed in this workspace.</p></section></div><footer><Button onClick={() => void authorizeObserver(selected)} disabled={!sessions.some((session) => session.id === selected.id)}>Open read-only observer</Button>{sessions.some((session) => session.id === selected.id) ? <Button variant="danger" disabled={ending} onClick={() => void endSession(selected)}>{ending ? "Ending…" : "End Visit"}</Button> : null}</footer></aside></div> : null}{observer ? <StaffObserverClient sessionId={observer.id} visitorName={observer.visitor_name} prisonerName={observer.prisoner_name} token={observer.token} serverUrl={observer.serverUrl} onClose={() => setObserver(null)} /> : null}</div>;
}


type ResourceApiRow = { id: string; resource_type: "ROOM" | "DEVICE"; display_name: string; status: string; room_id?: string | null; health_state: string; last_heartbeat_at?: string | null; active_appointment_id?: string | null; waiting_version?: number | null; has_active_kiosk_credential?: number; kiosk_credential_last_used_at?: string | null; version: number };

function ResourcesPage({ onNotify, onReassign }: { onNotify: (message: string, tone?: Notice["tone"]) => void; onReassign: (input: ResourceReassignment) => Promise<void> }) {
  const [resources, setResources] = useState<ResourceApiRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState("");
  const [reassignReason, setReassignReason] = useState("Resource failure requires a controlled reassignment.");
  const [reassigning, setReassigning] = useState(false);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    const response = await fetch("/api/control/resources", { headers: { accept: "application/json" }, credentials: "include" });
    if (!response.ok) throw new Error("Resource records could not be loaded from the staff API.");
    const body = await response.json() as { resources?: ResourceApiRow[] };
    setResources(body.resources || []);
    setSelectedId((current) => current && (body.resources || []).some((resource) => resource.id === current) ? current : body.resources?.[0]?.id || null);
    setLoading(false);
  }
  useEffect(() => { const timer = window.setTimeout(() => { refresh().catch(() => setLoading(false)); }, 0); return () => window.clearTimeout(timer); }, []);
  const selected = resources.find((resource) => resource.id === selectedId) || resources[0];
  const rooms = resources.filter((resource) => resource.resource_type === "ROOM");
  const usableRooms = rooms.filter((resource) => resource.status !== "MAINTENANCE" && resource.status !== "OFFLINE");
  const devices = resources.filter((resource) => resource.resource_type === "DEVICE");
  const tone = (resource: ResourceApiRow) => resource.health_state === "FAILED" || resource.status === "OFFLINE" ? "red" : resource.status === "MAINTENANCE" || resource.status === "RESERVED" ? "orange" : resource.status === "IN_USE" ? "green" : "blue";
  const reassignmentTargets = selected?.active_appointment_id ? resources.filter((resource) => resource.id !== selected.id && resource.resource_type === selected.resource_type && resource.health_state === "HEALTHY" && resource.status === (selected.resource_type === "ROOM" ? "AVAILABLE" : "ONLINE") && !resource.active_appointment_id) : [];
  const effectiveReassignTargetId = reassignmentTargets.some((resource) => resource.id === reassignTargetId) ? reassignTargetId : reassignmentTargets[0]?.id || "";

  async function submitReassignment() {
    if (!selected?.active_appointment_id || !effectiveReassignTargetId) return;
    const target = resources.find((resource) => resource.id === effectiveReassignTargetId);
    if (!target) return;
    if (reassignReason.trim().length < 8) {
      onNotify("Enter at least eight characters explaining the reassignment.", "warning");
      return;
    }
    setReassigning(true);
    try {
      await onReassign({ appointmentId: selected.active_appointment_id, sourceResourceId: selected.id, targetResourceId: target.id, expectedSourceVersion: selected.version, expectedTargetVersion: target.version, expectedWaitingVersion: selected.waiting_version ?? 0, reason: reassignReason.trim() });
      await refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESOURCE_REASSIGNMENT_FAILED";
      const message = code === "STALE_RESOURCE" || code === "STALE_TARGET_RESOURCE" || code === "STALE_WAITING_ROOM" ? "The assignment changed while you were reviewing it. Refresh the resource board and try again." : code === "TARGET_RESOURCE_UNUSABLE" ? "That resource is no longer healthy or available." : code === "RESOURCE_REASSIGNMENT_CONFLICT" ? "The target resource became reserved. Choose another available resource." : code;
      onNotify(message, "error");
    } finally { setReassigning(false); }
  }

  async function sendHeartbeat(resource: ResourceApiRow) {
    try {
      const response = await fetch("/api/control/resources", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "include", body: JSON.stringify({ resourceId: resource.id, command: "heartbeat", expectedVersion: resource.version, reason: "Staff requested a resource health check." }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Heartbeat update was rejected.");
      await refresh();
      onNotify(`${resource.display_name} heartbeat recorded.`, "success");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Heartbeat failed.", "error"); }
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations · Resource map"
        title="Resources"
        description="Rooms and kiosk devices are read from the facility resource catalog and current reservation records."
        actions={<><Button onClick={() => selected ? sendHeartbeat(selected) : onNotify("No resource is selected.", "warning")}>↻ Poll selected</Button><Button variant="primary" onClick={() => onNotify("Maintenance requests require a resource record and supervisor workflow.", "info")}>+ Maintenance request</Button></>}
      />
      {loading ? <div className="sv3-empty"><span>◌</span><strong>Loading resource catalog</strong><p>Reading facility-scoped room and device state.</p></div> : !resources.length ? <EmptyState title="No resource catalog configured" body="Apply the resources migration and seed the facility room/device records before approving appointments." /> : (
        <>
          <div className="sv3-resource-summary">
            <div className="sv3-resource-hero">
              <span className="sv3-eyebrow">Facility capacity</span>
              <strong>{usableRooms.length} <small>/ {rooms.length}</small></strong>
              <p>rooms currently usable</p>
              <div className="sv3-capacity-bar"><i style={{ width: `${Math.round((usableRooms.length / Math.max(1, rooms.length)) * 100)}%` }} /></div>
              <span>{rooms.filter((resource) => !resource.active_appointment_id).length} rooms without an active reservation</span>
            </div>
            <div><span>Online kiosks</span><strong>{devices.filter((resource) => resource.status === "ONLINE").length} / {devices.length}</strong><small>Catalog state · live API</small></div>
            <div><span>Active reservations</span><strong>{resources.filter((resource) => resource.active_appointment_id).length}</strong><small>Room and device assignments</small></div>
          </div>
          <div className="sv3-resource-layout">
            <section className="sv3-resource-board">
              <div className="sv3-resource-board-head"><div><span className="sv3-eyebrow">Live resource board</span><h2>Rooms & kiosks</h2></div><div className="sv3-resource-legend"><span><i className="green" />Healthy</span><span><i className="orange" />Reserved</span><span><i className="red" />Attention</span></div></div>
              <div className="sv3-resource-grid">{resources.map((resource) => <button key={resource.id} className={`sv3-resource-tile resource-${tone(resource)} ${selected?.id === resource.id ? "selected" : ""}`} onClick={() => setSelectedId(resource.id)}><div><span>{resource.resource_type}</span><Status tone={tone(resource)}>{resource.status}</Status></div><strong>{resource.display_name}</strong><small>{resource.active_appointment_id ? `Reserved for ${resource.active_appointment_id}` : resource.room_id ? `Attached to ${resource.room_id}` : resource.health_state}</small><i className="resource-signal" /></button>)}</div>
            </section>
            {selected ? (
              <aside className="sv3-resource-detail">
                <span className="sv3-eyebrow">Selected resource</span>
                <h2>{selected.display_name}</h2>
                <Status tone={tone(selected)}>{selected.status}</Status>
                <dl>
                  <div><dt>Health</dt><dd>{selected.health_state}</dd></div>
                  <div><dt>Last heartbeat</dt><dd>{selected.last_heartbeat_at ? new Date(selected.last_heartbeat_at).toLocaleString() : "Not recorded"}</dd></div>
                  <div><dt>Current reservation</dt><dd>{selected.active_appointment_id || "None"}</dd></div>
                  <div><dt>Version</dt><dd className="sv8-mono">{selected.version}</dd></div>
                </dl>
                {selected.active_appointment_id && (selected.status === "OFFLINE" || selected.health_state === "FAILED") ? <div className="sv3-resource-warning"><strong>Assignment requires attention</strong><span>{selected.active_appointment_id}</span><small>Move this visit to a healthy {selected.resource_type === "DEVICE" ? "kiosk" : "room"} before admission.</small>{reassignmentTargets.length ? <><label>Healthy target<select value={effectiveReassignTargetId} onChange={(event) => setReassignTargetId(event.target.value)}><option value="">Choose a target</option>{reassignmentTargets.map((resource) => <option key={resource.id} value={resource.id}>{resource.display_name} · v{resource.version}</option>)}</select></label><label>Reason<textarea value={reassignReason} onChange={(event) => setReassignReason(event.target.value)} minLength={8} /></label><Button variant="primary" onClick={() => void submitReassignment()} disabled={reassigning || !effectiveReassignTargetId}>{reassigning ? "Reassigning…" : "Reassign visit"}</Button></> : <small>No healthy unreserved target is currently available.</small>}</div> : <Button onClick={() => sendHeartbeat(selected)}>Record heartbeat</Button>}
                {selected.resource_type === "DEVICE" ? <KioskCredentialManager key={selected.id} resourceId={selected.id} resourceName={selected.display_name} resourceVersion={selected.version} active={selected.has_active_kiosk_credential === 1} lastUsedAt={selected.kiosk_credential_last_used_at} onRefresh={refresh} onNotify={onNotify} /> : null}
              </aside>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}


type IncidentApiRow = { id: string; incident_type: string; severity: string; status: string; title: string; description: string; appointment_id?: string | null; resource_id?: string | null; reporter_name?: string; assignee_name?: string | null; assigned_user_id?: string | null; resolution?: string | null; version: number; created_at: string };

function IncidentsPage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [incidents, setIncidents] = useState<IncidentApiRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    const response = await fetch("/api/control/incidents", { headers: { accept: "application/json" }, credentials: "include" });
    if (!response.ok) throw new Error("Incident records could not be loaded from the protected API.");
    const body = await response.json() as { incidents?: IncidentApiRow[] };
    setIncidents(body.incidents || []);
    setSelectedId((current) => current && (body.incidents || []).some((incident) => incident.id === current) ? current : body.incidents?.[0]?.id || null);
    setLoading(false);
  }
  useEffect(() => { const timer = window.setTimeout(() => { refresh().catch(() => setLoading(false)); }, 0); return () => window.clearTimeout(timer); }, []);
  const selected = incidents.find((incident) => incident.id === selectedId) || incidents[0];
  async function command(action: "acknowledge" | "resolve" | "close" | "add_note", reason: string) {
    if (!selected) return;
    try {
      const response = await fetch("/api/control/incidents", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `incident:${selected.id}:${action}:${selected.version}` }, credentials: "include", body: JSON.stringify({ incidentId: selected.id, command: action, expectedVersion: selected.version, reason, resolution: action === "resolve" ? reason : undefined }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Incident action was rejected.");
      await refresh();
      onNotify(`Incident ${action.replaceAll("_", " ")} recorded.`, "success");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Incident action failed.", "error"); }
  }
  return <><PageHeader eyebrow="Operations · Case management" title="Incidents" description="Persisted operational cases, append-only event history, and controlled resolution actions." actions={<><Status tone="red">{incidents.filter((incident) => !["RESOLVED", "CLOSED"].includes(incident.status)).length} OPEN</Status><Button variant="primary" onClick={() => onNotify("Create incident from a related visit, session, or resource record through the protected incident API.", "info")}>+ Report incident</Button></>} />{loading ? <div className="sv3-empty"><span>◌</span><strong>Loading incident register</strong><p>Reading facility-scoped operational cases.</p></div> : !incidents.length ? <EmptyState title="No incidents recorded" body="Operational problems will appear here when staff create a persisted incident case." /> : <div className="sv3-incident-layout"><section className="sv3-incident-list"><div className="sv3-incident-list-head"><span>OPEN INCIDENTS</span><button onClick={() => refresh().catch(() => undefined)}>Refresh</button></div>{incidents.map((incident) => <button className={`sv3-incident-row ${selected?.id === incident.id ? "active" : ""}`} key={incident.id} onClick={() => setSelectedId(incident.id)}><span className={`sv3-severity severity-${incident.severity.toLowerCase()}`}>{incident.severity}</span><strong>{incident.title}</strong><small>{incident.id} · {new Date(incident.created_at).toLocaleString()}</small><span className="sv3-incident-meta">{incident.appointment_id || incident.resource_id || "Facility-wide"} · {incident.status}</span><b>›</b></button>)}</section>{selected ? <article className="sv3-incident-detail"><div className="sv3-incident-detail-head"><div><span className={`sv3-severity severity-${selected.severity.toLowerCase()}`}>{selected.severity}</span><span className="sv3-eyebrow">INCIDENT {selected.id}</span><h2>{selected.title}</h2><p>{selected.description}</p></div><Status tone={selected.status === "OPEN" ? "red" : selected.status === "RESOLVED" || selected.status === "CLOSED" ? "green" : "orange"}>{selected.status}</Status></div><div className="sv3-incident-columns"><div><SectionLabel>Case facts</SectionLabel><dl><div><dt>Type</dt><dd>{selected.incident_type}</dd></div><div><dt>Reporter</dt><dd>{selected.reporter_name || "Staff"}</dd></div><div><dt>Assignee</dt><dd>{selected.assignee_name || "Unassigned"}</dd></div><div><dt>Related visit</dt><dd>{selected.appointment_id || "None"}</dd></div></dl></div><div><SectionLabel>Resolution</SectionLabel><p>{selected.resolution || "No resolution recorded."}</p><div className="sv3-header-actions"><Button onClick={() => command("acknowledge", "Monitoring officer acknowledged this incident for investigation.")} disabled={selected.status !== "OPEN"}>Acknowledge</Button><Button onClick={() => command("add_note", "Staff reviewed the incident and added an operational note.")}>Add note</Button><Button variant="primary" onClick={() => command("resolve", "Incident investigation completed; operational controls restored.")} disabled={["RESOLVED", "CLOSED"].includes(selected.status)}>Resolve</Button><Button variant="quiet" onClick={() => command("close", "Supervisor confirmed the incident record is complete.")} disabled={selected.status !== "RESOLVED"}>Close</Button></div></div></div></article> : null}</div>}</>;
}

function CopyableId({ value }: { value: string }) {
  return <span className="sv3-copyable-id"><span>{value}</span><button type="button" aria-label={`Copy ${value}`} onClick={(event) => { event.stopPropagation(); void navigator.clipboard?.writeText(value); }}>⧉</button></span>;
}

function CapacityPopover({ resources, loading, onOpen }: { resources: ResourceApiRow[]; loading: boolean; onOpen: () => void }) {
  const rooms = resources.filter((resource) => resource.resource_type === "ROOM");
  const occupied = rooms.filter((resource) => resource.active_appointment_id || resource.status === "IN_USE").length;
  return <div className="sv3-popover sv3-metric-popover"><span className="sv3-eyebrow">Facility capacity</span><strong>{loading ? "Loading room status" : rooms.length ? `${occupied} / ${rooms.length} rooms assigned` : "Room status unavailable"}</strong>{loading ? <p>Reading the protected resource register.</p> : rooms.length ? <div className="sv3-popover-list">{rooms.slice(0, 6).map((room) => <span key={room.id}><b>{room.display_name}</b><em>{room.active_appointment_id ? "In use" : room.status.toLowerCase().replaceAll("_", " ")}</em></span>)}</div> : <p>No facility room records were returned for this staff scope.</p>}<button type="button" onClick={onOpen}>Open Resources →</button></div>;
}

function WaitingPopover({ visits, loading, onOpen }: { visits: CommandWaitingVisit[]; loading: boolean; onOpen: () => void }) {
  const stateLabel = (visit: CommandWaitingVisit) => (visit.state || visit.readiness?.state || "NOT_ARRIVED").replaceAll("_", " ");
  return <div className="sv3-popover sv3-metric-popover"><span className="sv3-eyebrow">Waiting room</span><strong>{loading ? "Loading readiness lanes" : `${visits.length} linked visits`}</strong>{loading ? <p>Reading persisted presence and readiness.</p> : visits.length ? <div className="sv3-popover-list">{visits.slice(0, 4).map((visit) => <span key={visit.id}><b>{visit.visitor_name || "Visitor name unavailable"}</b><em>{stateLabel(visit)}</em></span>)}</div> : <p>No approved visits are currently in the Waiting Room window.</p>}<button type="button" onClick={onOpen}>Open Waiting Room →</button></div>;
}

function SessionPopover({ sessions, loading, onOpen }: { sessions: CommandLiveSession[]; loading: boolean; onOpen: () => void }) {
  const participantCount = (session: CommandLiveSession) => session.participants?.filter((participant) => participant.status !== "DISCONNECTED").length || 0;
  return <div className="sv3-popover sv3-metric-popover"><span className="sv3-eyebrow">Session status</span><strong>{loading ? "Loading session status" : sessions.length ? `${sessions.length} active session${sessions.length === 1 ? "" : "s"}` : "No active sessions"}</strong>{loading ? <p>Reading the protected Live Session register.</p> : sessions.length ? <div className="sv3-popover-list">{sessions.slice(0, 4).map((session) => <span key={session.id}><b>{session.visitor_name || "Visitor name unavailable"} ↔ {session.prisoner_name || "Prisoner name unavailable"}</b><em>{session.status} · {participantCount(session)} connected</em></span>)}</div> : <p>No active LiveKit sessions are currently recorded for this facility.</p>}<button type="button" onClick={onOpen}>Open live sessions →</button></div>;
}

type DrawerResource = { id: string; display_name: string; status: string; resource_type: string; health_state: string; room_id?: string | null; last_heartbeat_at?: string | null; active_appointment_id?: string | null; version: number };
type DrawerWaitingVisit = { id: string; visitor_name?: string | null; prisoner_name?: string | null; state?: string | null; assigned_room_name?: string | null; assigned_kiosk_name?: string | null; visitor_presence?: string | null; prisoner_presence?: string | null; staff_notes?: string | null; version?: number | null };
type DrawerIncident = { id: string; incident_type: string; severity: string; status: string; title: string; description: string; appointment_id?: string | null; resource_id?: string | null; reporter_name?: string | null; assignee_name?: string | null; resolution?: string | null; version: number };

function ContextDrawer({ payload, onClose, onOpenAppointment, onRequestApproval }: { payload: DrawerPayload; onClose: () => void; onOpenAppointment: (appointment: Appointment) => void; onRequestApproval: (appointment: Appointment) => void; onReassign: (input: ResourceReassignment) => Promise<void>; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [remote, setRemote] = useState<{ kind: "resource"; record: DrawerResource } | { kind: "waiting"; record: DrawerWaitingVisit } | { kind: "incident"; record: DrawerIncident } | null>(null);
  const [loading, setLoading] = useState(payload.kind !== "appointment" && payload.kind !== "activity");
  const [error, setError] = useState("");
  useEffect(() => {
    if (payload.kind === "appointment" || payload.kind === "activity") return;
    let active = true;
    const load = async () => {
      try {
        const endpoint = payload.kind === "device" ? "/api/control/resources" : payload.kind === "waiting" ? "/api/control/waiting-room" : "/api/control/incidents";
        const response = await fetch(endpoint, { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
        const body = await response.json() as { resources?: DrawerResource[]; visits?: DrawerWaitingVisit[]; incidents?: DrawerIncident[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Protected record unavailable.");
        const record = payload.kind === "device" ? body.resources?.find((item) => item.display_name === payload.device) : payload.kind === "waiting" ? body.visits?.find((item) => item.visitor_name === payload.visitor) : body.incidents?.find((item) => item.id === payload.id);
        if (active) { setRemote(record ? { kind: payload.kind === "device" ? "resource" : payload.kind, record: record as DrawerResource & DrawerWaitingVisit & DrawerIncident } : null); setError(""); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Protected record unavailable.");
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [payload]);
  const title = payload.kind === "appointment" ? payload.appointment.id : payload.kind === "activity" ? payload.event : payload.kind === "device" ? payload.device : payload.kind === "waiting" ? payload.visitor : payload.id;
  const eyebrow = payload.kind === "appointment" ? "Appointment review" : payload.kind === "activity" ? "Related activity" : payload.kind === "device" ? "Persisted resource" : payload.kind === "waiting" ? "Waiting Room record" : "Persisted incident";
  return <div className="sv3-drawer-backdrop" onClick={onClose}><aside className="sv3-drawer sv3-context-drawer" role="dialog" aria-modal="true" aria-labelledby="context-drawer-title" onClick={(event) => event.stopPropagation()}><div className="sv3-drawer-head"><div><span className="sv3-eyebrow">{eyebrow}</span><h2 id="context-drawer-title">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close context drawer">×</button></div>{payload.kind === "appointment" ? <><div className="sv3-drawer-person"><Avatar initials={payload.appointment.visitorInitials} tone="orange" /><div><strong>{payload.appointment.visitor}</strong><span>{payload.appointment.type} visit with {payload.appointment.prisoner}</span></div><Status tone={payload.appointment.status === "Blocked" ? "red" : payload.appointment.status === "Live" ? "green" : "orange"}>{payload.appointment.status}</Status></div><DrawerSection title="Persisted appointment"><DetailRow label="Requested" value={`${payload.appointment.date} · ${payload.appointment.time}`} mono /><DetailRow label="Resources" value={`${payload.appointment.room} · ${payload.appointment.kiosk}`} /><DetailRow label="Relationship" value={payload.appointment.relationshipStatus || "Unavailable"} positive={payload.appointment.relationshipStatus === "APPROVED"} /><DetailRow label="Visit credit" value={payload.appointment.activeCreditReservation ? "Reserved" : `${payload.appointment.availableCredits ?? 0} available`} /></DrawerSection><DrawerSection title="Audit reference"><CopyableId value={payload.appointment.id} /><small>Decisions are recorded against the facility audit trail.</small></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button><Button onClick={() => onOpenAppointment(payload.appointment)}>Full appointment</Button>{payload.appointment.status !== "Approved" && payload.appointment.status !== "Live" ? <Button variant="primary" onClick={() => onRequestApproval(payload.appointment)}>Review decision</Button> : null}</DrawerFooter></> : payload.kind === "activity" ? <><DrawerSection title="Recorded event"><DetailRow label="Source" value={payload.source} /><CopyableId value={payload.relatedId} /><p>This event is linked to a persisted operational record.</p></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button></DrawerFooter></> : loading ? <EmptyState title="Loading protected record" body="Reading the facility-scoped operational record." /> : error ? <EmptyState title="Record unavailable" body={error} /> : !remote ? <EmptyState title="Record not found" body="The requested record is no longer available in this facility scope." /> : remote.kind === "resource" ? <><DrawerSection title="Resource status"><DetailRow label="Name" value={remote.record.display_name} /><DetailRow label="Type" value={remote.record.resource_type} /><DetailRow label="Availability" value={remote.record.status} /><DetailRow label="Health" value={remote.record.health_state} positive={remote.record.health_state === "HEALTHY"} /><DetailRow label="Active appointment" value={remote.record.active_appointment_id || "None"} mono /></DrawerSection><DrawerSection title="Operational metadata"><DetailRow label="Last heartbeat" value={remote.record.last_heartbeat_at || "Not recorded"} mono /><DetailRow label="Version" value={String(remote.record.version)} mono /></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button></DrawerFooter></> : remote.kind === "waiting" ? <><DrawerSection title="Readiness record"><DetailRow label="Visitor" value={remote.record.visitor_name || "Unavailable"} /><DetailRow label="Prisoner" value={remote.record.prisoner_name || "Unavailable"} /><DetailRow label="State" value={(remote.record.state || "NOT_ARRIVED").replaceAll("_", " ")} /><DetailRow label="Visitor presence" value={remote.record.visitor_presence || "Not recorded"} /><DetailRow label="Prisoner presence" value={remote.record.prisoner_presence || "Not recorded"} /></DrawerSection><DrawerSection title="Assignment and notes"><DetailRow label="Room" value={remote.record.assigned_room_name || "Unassigned"} /><DetailRow label="Kiosk" value={remote.record.assigned_kiosk_name || "Unassigned"} /><p>{remote.record.staff_notes || "No staff notes recorded."}</p></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button></DrawerFooter></> : <><DrawerSection title="Incident record"><DetailRow label="Severity" value={remote.record.severity} /><DetailRow label="Status" value={remote.record.status} /><DetailRow label="Type" value={remote.record.incident_type} /><DetailRow label="Reporter" value={remote.record.reporter_name || "Unavailable"} /><DetailRow label="Assignee" value={remote.record.assignee_name || "Unassigned"} /></DrawerSection><DrawerSection title="Description"><p>{remote.record.description}</p><p>{remote.record.resolution || "No resolution recorded."}</p></DrawerSection><DrawerFooter><Button variant="quiet" onClick={onClose}>Close</Button></DrawerFooter></>}</aside></div>;
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) { return <section className="sv3-drawer-section"><span className="sv3-eyebrow">{title}</span>{children}</section>; }
function DetailRow({ label, value, mono = false, positive = false }: { label: string; value: string; mono?: boolean; positive?: boolean }) { return <div className="sv3-detail-row"><span>{label}</span><strong className={`${mono ? "sv3-mono-value" : ""} ${positive ? "sv3-positive" : ""}`}>{positive ? "✓ " : ""}{value}</strong></div>; }
function DrawerFooter({ children }: { children: ReactNode }) { return <div className="sv3-drawer-actions">{children}</div>; }

function ImpactDialog({ appointment, onClose, onConfirm }: { appointment: Appointment; onClose: () => void; onConfirm: () => void }) {
  const checks = [
    { label: "Visitor relationship", ready: appointment.relationshipStatus === "APPROVED", value: appointment.relationshipStatus?.replaceAll("_", " ") || "Not verified" },
    { label: "Prisoner eligibility", ready: appointment.prisonerStatus === "ACTIVE" && appointment.visitationStatus === "APPROVED", value: appointment.prisonerStatus === "ACTIVE" && appointment.visitationStatus === "APPROVED" ? "Eligible" : "Not confirmed" },
    { label: "Facility operating state", ready: appointment.facilityState === "NORMAL_OPERATIONS", value: appointment.facilityState?.replaceAll("_", " ") || "Not confirmed" },
    { label: "Visit credit", ready: appointment.activeCreditReservation || (appointment.availableCredits || 0) > 0, value: appointment.activeCreditReservation ? "Already reserved" : `${appointment.availableCredits ?? 0} available` },
  ];
  const canApprove = Number.isSafeInteger(appointment.version) && checks.every((check) => check.ready);
  return <div className="sv3-modal-backdrop" onClick={onClose}><section className="sv3-dialog sv3-impact-dialog" role="dialog" aria-modal="true" aria-labelledby="impact-title" onClick={(event) => event.stopPropagation()}><div className="sv3-dialog-head"><div><span className="sv3-eyebrow">Approval impact</span><h2 id="impact-title">Approve visit</h2><p>{appointment.visitor} ↔ {appointment.prisoner} · <span className="sv3-mono-value">{appointment.time}</span></p></div><button type="button" onClick={onClose} aria-label="Close approval dialog">×</button></div><div className="sv3-impact-list"><strong>Approval will:</strong><span>✓ Reserve an available room{appointment.room !== "Unassigned" ? ` (currently ${appointment.room})` : ""}</span><span>✓ Reserve an available facility device{appointment.kiosk !== "Unassigned" ? ` (currently ${appointment.kiosk})` : ""}</span><span>✓ {appointment.activeCreditReservation ? "Keep the existing Visit Credit reservation" : "Reserve 1 Visit Credit"}</span><span>✓ Queue a visitor notification and record the decision in the audit history</span></div><div className="sv3-policy-check"><strong>Current eligibility</strong>{checks.map((check) => <span key={check.label}>{check.ready ? "✓" : "!"} {check.label}: {check.value}</span>)}<span>! Room/device conflicts and policy are checked again when you confirm.</span></div>{!canApprove ? <p role="alert" className="sv3-alert-note">Approval is unavailable because required eligibility data is missing or a current check failed. No decision has been submitted.</p> : null}<div className="sv3-dialog-actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={onConfirm} disabled={!canApprove}>Approve visit</Button></div></section></div>;
}

function AlertDialog({ title, description, stats, onCancel, onConfirm }: { title: string; description: string; stats: string[]; onCancel: () => void; onConfirm: (reason: string, details: string) => void }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("Facility-wide operational response requiring staff review of affected visits.");
  return <div className="sv3-modal-backdrop" onClick={onCancel}><section className="sv3-dialog sv3-alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="alert-title" onClick={(event) => event.stopPropagation()}><div className="sv3-dialog-head"><div><span className="sv3-eyebrow">Destructive facility command</span><h2 id="alert-title">{title}</h2><p>{description}</p></div><button type="button" onClick={onCancel} aria-label="Close lockdown dialog">×</button></div><div className="sv3-lockdown-stats">{stats.map((stat) => <div key={stat}><strong>{stat.split(" ")[0]}</strong><span>{stat.slice(stat.indexOf(" ") + 1)}</span></div>)}</div><label className="sv3-dialog-field">Reason<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="" disabled>Select reason</option><option>Security incident</option><option>Facility emergency</option><option>Technical containment</option></select></label><label className="sv3-dialog-field">Details<textarea value={details} onChange={(event) => setDetails(event.target.value)} /></label><p className="sv3-alert-note">This action is facility-wide and will be recorded in the audit trail. Credits, appointments, and resources are not automatically settled by this command.</p><div className="sv3-dialog-actions"><Button variant="quiet" onClick={onCancel}>Keep normal operations</Button><Button variant="danger" onClick={() => onConfirm(reason, details)} disabled={!reason || !details.trim()}>Declare lockdown</Button></div></section></div>;
}

function CommandPalette({ appointments, onClose, onOpenAppointment, onNavigate }: { appointments: Appointment[]; onClose: () => void; onOpenAppointment: (appointment: Appointment) => void; onNavigate: (page: string) => void }) {
  const [query, setQuery] = useState("");
  const results = appointments.filter((appointment) => `${appointment.id} ${appointment.visitor} ${appointment.prisoner}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4);
  return <div className="sv3-modal-backdrop sv3-command-palette-backdrop" onClick={onClose}><section className="sv3-command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-title" onClick={(event) => event.stopPropagation()}><div className="sv3-palette-search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, appointments, resources…" /></div><div className="sv3-palette-group"><span className="sv3-eyebrow" id="palette-title">Appointments</span>{results.map((appointment) => <button type="button" key={appointment.id} onClick={() => { onClose(); onOpenAppointment(appointment); }}><span><strong>{appointment.id}</strong><small>{appointment.visitor} ↔ {appointment.prisoner}</small></span><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "blue"}>{appointment.status}</Status></button>)}</div><div className="sv3-palette-group"><span className="sv3-eyebrow">Actions</span><button type="button" onClick={() => { onClose(); onNavigate("Resources"); }}>Open resource workspace</button><button type="button" onClick={() => { onClose(); onNavigate("Waiting Room"); }}>Open Waiting Room</button><button type="button" onClick={() => { onClose(); onNavigate("Resources"); }}>Go to Resources</button></div><div className="sv3-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div></section></div>;
}

function AppointmentDrawer({ appointment, onClose, onRequestApproval, onUpdate }: { appointment: Appointment; onClose: () => void; onRequestApproval: () => void; onUpdate: (id: string, status: AppointmentStatus, commandOverride?: "approve" | "reject" | "request_info" | "cancel" | "no_show") => void }) {
  const reviewable = ["SUBMITTED", "UNDER_REVIEW"].includes(appointment.rawStatus || "") && Number.isSafeInteger(appointment.version);
  const relationship = appointment.relationshipStatus ? `${appointment.relationshipType || "Relationship"} · ${appointment.relationshipStatus.toLowerCase()}` : "Not available";
  const credit = appointment.activeCreditReservation ? "Reserved for this visit" : `${appointment.availableCredits ?? 0} available · ${appointment.reservedCredits ?? 0} reserved overall`;
  return <div className="sv3-drawer-backdrop" onClick={onClose}><aside className="sv3-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-drawer-title" onClick={(event) => event.stopPropagation()}><div className="sv3-drawer-head"><div><span className="sv3-eyebrow">Appointment review</span><h2 id="appointment-drawer-title"><CopyableId value={appointment.id} /></h2></div><button onClick={onClose} aria-label="Close review">×</button></div><div className="sv3-drawer-person"><Avatar initials={appointment.visitorInitials} tone="orange" /><div><strong>{appointment.visitor}</strong><span>{appointment.type} visit with {appointment.prisoner}</span></div><Status tone={appointment.status === "Blocked" ? "red" : appointment.status === "Live" ? "green" : "orange"}>{appointment.status}</Status></div><div className="sv3-drawer-details"><div><span>Requested</span><strong className="sv3-mono-value">{appointment.date} · {appointment.time}</strong></div><div><span>Resources</span><strong>{appointment.room} · {appointment.kiosk}</strong></div><div><span>Relationship</span><strong>{relationship}</strong></div><div><span>Visit credits</span><strong>{credit}</strong></div></div><div className="sv3-approval-preview"><span className="sv3-eyebrow">Eligibility snapshot</span><p>These values are read from the facility record. The server will recheck eligibility, policy, available resources, and credit when a decision is submitted.</p><span>{appointment.prisonerStatus === "ACTIVE" && appointment.visitationStatus === "APPROVED" ? "✓" : "!"} Prisoner {appointment.prisonerStatus?.toLowerCase() || "status unavailable"} · visitation {appointment.visitationStatus?.toLowerCase() || "not confirmed"}</span><span>{appointment.facilityState === "NORMAL_OPERATIONS" ? "✓" : "!"} Facility {appointment.facilityState?.toLowerCase().replaceAll("_", " ") || "state unavailable"}</span><span>{appointment.relationshipStatus === "APPROVED" ? "✓" : "!"} Visitor relationship {appointment.relationshipStatus?.toLowerCase() || "not verified"}</span><span>{appointment.activeCreditReservation || (appointment.availableCredits || 0) > 0 ? "✓" : "!"} {credit}</span></div><div className="sv3-drawer-actions"><Button variant="quiet" onClick={onClose}>Close</Button>{reviewable ? <>{appointment.rawStatus === "SUBMITTED" ? <Button variant="quiet" onClick={() => onUpdate(appointment.id, "Requires action")}>Request information</Button> : null}<Button variant="danger" onClick={() => onUpdate(appointment.id, "Blocked")}>Decline</Button><Button variant="primary" onClick={onRequestApproval}>Approve visit</Button></> : null}{["APPROVED", "WAITING"].includes(appointment.rawStatus || "") ? <Button variant="danger" onClick={() => onUpdate(appointment.id, "Blocked", "no_show")}>Mark no-show</Button> : null}</div></aside></div>;
}

type VerificationQueueCase = {
  id: string; relationship_id: string; status: string; evidence_required: number; submitted_at: string; version: number;
  visitor_user_id: string; prisoner_id: string; relationship_type: string; visitor_name: string; prisoner_number: string; prisoner_name: string; evidence_count: number;
};
type VerificationEvidence = { id: string; original_filename: string; content_type: string; byte_size: number; status: string; created_at: string };

function VerificationQueue({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
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
        headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `verification-${selected.id}-${selected.version}-${status}-${crypto.randomUUID()}` },
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
        {loading ? <div className="sv3-verification-empty">Loading persisted verification cases…</div> : activeCases.length ? activeCases.map((item) => <button type="button" className={`sv3-verification-row ${selectedId === item.id ? "active" : ""}`} key={item.id} onClick={() => { setSelectedId(item.id); setReason(""); setError(""); }}><span className="sv3-verification-avatar">{item.visitor_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="sv3-verification-row-copy"><strong>{item.visitor_name}</strong><small>{item.relationship_type} · {item.prisoner_name} ({item.prisoner_number})</small><small>{new Date(item.submitted_at).toLocaleString()}</small></span><Status tone={item.status === "MORE_INFO" ? "orange" : "purple"}>{item.status.replaceAll("_", " ")}</Status><span className="sv3-verification-count">{item.evidence_count} file{Number(item.evidence_count) === 1 ? "" : "s"}</span></button>) : <div className="sv3-verification-empty">{error ? "The queue could not be loaded." : "No open connection cases. New visitor requests will appear here."}</div>}
      </section>
      <section className="sv3-verification-detail">{selected ? <>
        <div className="sv3-verification-detail-head"><div><span className="sv3-eyebrow">Verification case</span><h2>{selected.visitor_name}</h2><p>Request {selected.id}</p></div><Status tone={selected.status === "MORE_INFO" ? "orange" : selected.status === "PENDING" || selected.status === "IN_REVIEW" ? "purple" : "green"}>{selected.status.replaceAll("_", " ")}</Status></div>
        <div className="sv3-verification-facts"><div><span>Requested connection</span><strong>{selected.relationship_type}</strong></div><div><span>Person in custody</span><strong>{selected.prisoner_name} · {selected.prisoner_number}</strong></div><div><span>Submitted</span><strong>{new Date(selected.submitted_at).toLocaleString()}</strong></div><div><span>Evidence rule</span><strong>{selected.evidence_required ? "Supporting document required" : "Manual review allowed"}</strong></div></div>
        <div className="sv3-verification-documents"><div><span className="sv3-eyebrow">Submitted evidence</span><small>Each protected file access is recorded in the facility audit trail.</small></div>
          {evidenceLoading ? <p>Loading document list…</p> : selectedEvidenceError ? <p className="sv3-verification-message error">{selectedEvidenceError}</p> : evidenceForCaseId === selected.id && evidence.filter((file) => file.status === "AVAILABLE").length ? evidence.filter((file) => file.status === "AVAILABLE").map((file) => <a key={file.id} href={`/api/control/verification/evidence/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer"><span>▤</span><span><strong>{file.original_filename}</strong><small>{file.content_type} · {(file.byte_size / 1024).toFixed(0)} KB · {new Date(file.created_at).toLocaleDateString()}</small></span><b>Open protected file ↗</b></a>) : evidenceForCaseId === selected.id ? <p>{selected.evidence_required ? "No available evidence yet. The visitor must upload a supporting document before approval." : "No document submitted; the case may be reviewed manually."}</p> : null}
        </div>
        <label className="sv3-verification-reason">Decision reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} placeholder="Record what was verified or what is still needed…" /></label>
        {error && <div className="sv3-verification-message error" role="alert">{error}</div>}
        <div className="sv3-verification-actions"><Button variant="quiet" onClick={() => void decide("MORE_INFO")} disabled={saving}>{saving ? "Saving…" : "Request information"}</Button><Button variant="danger" onClick={() => void decide("REJECTED")} disabled={saving}>{saving ? "Saving…" : "Decline"}</Button><Button variant="primary" onClick={() => void decide("APPROVED")} disabled={saving || (Boolean(selected.evidence_required) && evidence.filter((file) => file.status === "AVAILABLE").length === 0)}>{saving ? "Saving…" : "Approve connection"}</Button></div>
      </> : <div className="sv3-verification-empty">Select a case to review the request and its supporting documents.</div>}</section>
    </div>
  </div>;
}

function PeoplePage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
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
            const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(visitAt);
            const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const tomorrowKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
            nextDate = dateKey === todayKey ? "Today" : dateKey === tomorrowKey ? "Tomorrow" : new Intl.DateTimeFormat("en-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" }).format(visitAt);
            const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(visitAt);
            nextTime = `${time} WIB${row.next_room ? ` · ${String(row.next_room)}` : ""}`;
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
  }, []);

  if (tab === "Verifications") return <div className="sv6-people-page"><PageHeader eyebrow="Management · People" title="People" description="Review visitor identity and relationship evidence using facility-scoped records." /><div className="sv3-entity-tabs sv6-entity-tabs">{reviewTabs.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => { setTab(item); setSearch(""); setStatusFilter("All statuses"); setVisitFilter("All visits"); }}>{item}</button>)}</div><VerificationQueue onNotify={onNotify} /></div>;
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
function VisitationPage() {
  const [tab, setTab] = useState("Visit Policies");
  const tabs = ["Visit Policies", "Appointment Types", "Availability Rules", "Operating Hours", "Closures"];
  return <><PageHeader eyebrow="Management · Visitation policy" title="Visitation" description="Control the facility rules used to validate visitor booking requests." /><div className="sv3-policy-layout"><nav className="sv3-policy-nav">{tabs.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}><span>{item}</span><b>›</b></button>)}</nav><section className="sv3-policy-editor"><div className="sv3-policy-editor-head"><div><span className="sv3-eyebrow">Facility configuration</span><h2>{tab}</h2></div><Status tone={tab === "Visit Policies" ? "green" : "orange"}>{tab === "Visit Policies" ? "BACKEND CONNECTED" : "NOT YET CONNECTED"}</Status></div>{tab === "Visit Policies" ? <VisitPolicyEditor /> : <div className="sv3-settings-surface"><strong>This section is not yet connected to persisted facility data.</strong><p>Only Visit Policies currently reads and updates the authoritative scheduling rules. This section remains unavailable until its data model, permissions, history, and visitor-workflow effects are implemented.</p><Button onClick={() => setTab("Visit Policies")}>Open live visit policy</Button></div>}</section></div></>;
}

type FinanceRecord = { id: string; appointment_id?: string | null; entry_type?: string; amount?: number; created_at: string; visitor_name?: string; credit_quantity?: number; amount_minor?: number; currency?: string; status?: string };
type FinancePayload = { summary: { credits_purchased?: number; credits_consumed?: number; credits_reserved?: number; refund_cases?: number; pending_payments?: number; settled_amount_minor?: number; last_ledger_activity?: string | null }; ledger: FinanceRecord[]; payments: FinanceRecord[]; providerConfigured: boolean; reconciliation: { available: boolean; workerConfigured?: boolean; issueCount?: number; issues?: Array<{ issue_type: string; payment_intent_id: string | null; provider_event_id: string | null; detail: string }>; reason?: string } };

function FinancePage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Overview");
  const [data, setData] = useState<FinancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/control/finance", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as FinancePayload & { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to load financial records.");
      if (active) { setData(body); setLoading(false); }
    }).catch((reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : "Unable to load financial records."); setLoading(false); } });
    return () => { active = false; };
  }, []);
  const summary = data?.summary || {};
  const formatMoney = (minor: number | undefined) => minor === undefined ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(minor));
  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString("en-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) : "No recorded activity";
  const statusTone = (status: string) => ["SUCCEEDED", "REFUNDED"].includes(status) ? "green" : ["FAILED", "DISPUTED"].includes(status) ? "red" : "orange";
  const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  const ledger = data?.ledger || [];
  const payments = tab === "Refunds" ? (data?.payments || []).filter((payment) => ["REFUNDED", "DISPUTED"].includes(String(payment.status))) : data?.payments || [];
  const noData = loading ? "Loading persisted financial records…" : error || "No records have been persisted for this facility.";
  return <>
    <PageHeader eyebrow="Management · Financial controls" title="Finance" description="Facility-scoped credits, payment intents, and the append-only ledger." actions={<Button variant="primary" disabled={!data?.reconciliation.available} onClick={() => onNotify(data?.reconciliation.issueCount ? `${data.reconciliation.issueCount} reconciliation issue${data.reconciliation.issueCount === 1 ? "" : "s"} found. Provider actions still require review.` : "Read-only reconciliation checks completed with no issues.", data?.reconciliation.issueCount ? "warning" : "success")}>Run checks</Button>} />
    <div className="sv3-finance-tabs">{["Overview", "Ledger", "Payments", "Refunds", "Reconciliation"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>
    {!loading && error ? <div className="sv3-settings-surface"><strong>Financial records unavailable</strong><p>{error}</p></div> : null}
    {tab === "Overview" ? <div className="sv3-finance-overview">
      <div className="sv3-finance-metrics"><Metric label="Credits purchased" value={data ? String(summary.credits_purchased ?? 0) : "—"} detail="Persisted ledger total" tone="green" /><Metric label="Credits consumed" value={data ? String(summary.credits_consumed ?? 0) : "—"} detail="Settled visit usage" tone="blue" /><Metric label="Credits reserved" value={data ? String(summary.credits_reserved ?? 0) : "—"} detail="Current account reservations" tone="orange" /><Metric label="Refund cases" value={data ? String(summary.refund_cases ?? 0) : "—"} detail={`${summary.pending_payments ?? 0} payment intents pending`} tone="red" /></div>
      <div className="sv3-finance-lower"><section className="sv3-surface sv3-ledger-preview"><div className="sv3-surface-head"><div><span className="sv3-eyebrow">Append-only ledger</span><h2>Recent activity</h2></div><button className="sv3-link-button" onClick={() => setTab("Ledger")}>Open ledger →</button></div>{ledger.length ? ledger.slice(0, 5).map((row) => <div className="sv3-ledger-row" key={row.id}><time>{new Date(row.created_at).toLocaleTimeString("en-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}</time><span><strong>{label(String(row.entry_type))}</strong><small>{row.visitor_name || "Visitor unavailable"}{row.appointment_id ? ` · ${row.appointment_id}` : ""}</small></span><span>{row.amount === undefined ? "—" : `${row.amount > 0 ? "+" : ""}${row.amount} credit${Math.abs(row.amount) === 1 ? "" : "s"}`}</span><Status tone="green">RECORDED</Status></div>) : <div className="sv3-empty"><strong>{noData}</strong></div>}</section><aside className="sv3-reconcile-card"><span className="sv3-eyebrow">Reconciliation</span><strong>{data?.reconciliation.available ? "Available" : "Not configured"}</strong><p>{data?.reconciliation.available ? "A controlled reconciliation worker is available." : "No reconciliation worker is configured. No success state is being inferred from UI data."}</p><small>Last ledger activity · {formatDate(summary.last_ledger_activity)}</small></aside></div>
    </div> : <div className="sv3-finance-tab-content"><div className="sv3-finance-tab-head"><div><span className="sv3-eyebrow">{tab}</span><h2>{tab === "Ledger" ? "Credit ledger" : tab === "Refunds" ? "Refund cases" : tab === "Payments" ? "Provider transactions" : "Control checks"}</h2></div><span className="sv3-toolbar-meta">{data ? `${data.providerConfigured ? "Provider configured" : "Provider not configured"} · facility scope` : "Loading facility scope…"}</span></div>{tab === "Reconciliation" ? <div className="sv3-control-checks"><ControlCheck label="Credit ledger" detail={data ? `${ledger.length} recent entries loaded from D1` : noData} /><ControlCheck label="Payment provider" detail={data?.providerConfigured ? "Configured for this environment" : "Not configured; checkout cannot be treated as real money"} warning={!data?.providerConfigured} /><ControlCheck label="Settlement" detail={data ? `${formatMoney(summary.settled_amount_minor)} in succeeded payment intents` : noData} /><ControlCheck label="Worker" detail="No reconciliation worker is configured" warning /></div> : <div className="sv3-finance-table">{payments.length ? payments.map((row) => <button key={row.id} onClick={() => onNotify(`${row.id} is a persisted payment record.`)}><strong>{row.id}</strong><span>{row.visitor_name || "Visitor unavailable"}</span><span>{row.credit_quantity || 0} Visit Credit{row.credit_quantity === 1 ? "" : "s"}</span><span>{tab === "Refunds" ? label(String(row.status)) : formatMoney(row.amount_minor)}</span><Status tone={statusTone(String(row.status))}>{label(String(row.status))}</Status><b>→</b></button>) : <div className="sv3-empty"><strong>{noData}</strong></div>}</div>}</div>}
  </>;
}
function ControlCheck({ label, detail, warning = false }: { label: string; detail: string; warning?: boolean }) {
  return <div className={`sv3-control-check ${warning ? "warning" : ""}`}><span>{warning ? "!" : "✓"}</span><div><strong>{label}</strong><small>{detail}</small></div><b>{warning ? "Review" : "Passed"}</b></div>;
}

function CompliancePageInteractive({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
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

  return <><PageHeader eyebrow="Management · Compliance" title="Compliance" description="Investigate the record of what changed, who accessed sensitive material, and which reports are ready." actions={<Button variant="primary" disabled={!events.length || exporting} onClick={() => void exportAudit()}>{exporting ? "Preparing export…" : "Export scoped audit CSV"}</Button>} /><div className="sv3-compliance-tabs">{["Audit", "Recording Access", "Reports", "Security Events"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "Audit" ? <section className="sv3-audit-layout"><div className="sv3-audit-stream"><div className="sv3-audit-head"><div><span className="sv3-eyebrow">Chronological investigation trail</span><h2>Facility audit</h2></div><span className="sv3-toolbar-meta">{events.length} persisted events</span></div>{loading ? <EmptyState title="Loading audit records" body="Reading the facility-scoped append-only audit stream." /> : error ? <EmptyState title="Audit records unavailable" body={error} /> : events.length ? events.map((event) => <button className="sv3-audit-event" key={event.correlationId} onClick={() => onNotify(`${event.correlationId} is a persisted audit correlation.`)}><time>{new Date(event.createdAt).toLocaleTimeString("en-ID", { timeZone: "Asia/Jakarta" })}</time><span className="sv3-audit-dot" /><div><strong>{event.actionType}</strong><small>{event.actorRole || "System"} · {event.entityId || "Facility"}</small><p>{event.reason || "Recorded action"}</p><em>Correlation {event.correlationId}</em></div><b>›</b></button>) : <EmptyState title="No audit events recorded" body="No persisted events exist in the current facility scope." />}</div><aside className="sv3-audit-side"><div className="sv3-surface"><span className="sv3-eyebrow">Export controls</span><h2>Auditable by design</h2><p>Exports require facility scope, the audit export permission, and step-up authentication.</p><Button variant="primary" disabled={!events.length || exporting} onClick={() => void exportAudit()}>{exporting ? "Preparing…" : "Download CSV"}</Button></div></aside></section> : <ComplianceTab tab={tab} onNotify={onNotify} />}</>;
}

export function CompliancePage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Audit");
  type AuditRow = [string, string, string, string, string, string];
  const [events, setEvents] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/audit/events?limit=20", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Audit records unavailable.");
        const body = await response.json() as { events?: Array<{ createdAt: string; actionType: string; actorRole?: string | null; entityId?: string | null; reason?: string | null; correlationId: string }> };
        if (active) setEvents((body.events || []).map((event) => [event.createdAt.slice(11, 19), event.actionType, event.actorRole || "System", event.entityId || "Facility", event.reason || "Recorded action", event.correlationId]));
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Audit records unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <><PageHeader eyebrow="Management · Compliance" title="Compliance" description="Investigate the record of what changed, who accessed sensitive material, and which reports are ready." actions={<><Button disabled={!events.length} onClick={() => onNotify("Audit integrity verification requires the persisted audit service.", "info")}>✓ Verify integrity</Button><Button variant="primary" disabled={!events.length} onClick={() => onNotify("Scoped compliance export requires the persisted audit service.", "info")}>Export scoped report</Button></>} /><div className="sv3-compliance-tabs">{["Audit", "Recording Access", "Reports", "Security Events"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "Audit" ? <div className="sv3-audit-layout"><section className="sv3-audit-stream"><div className="sv3-audit-head"><div><span className="sv3-eyebrow">Chronological investigation trail</span><h2>Facility audit</h2></div><span className="sv3-toolbar-meta">{events.length} events · live scope</span></div>{loading ? <EmptyState title="Loading audit records" body="Reading the facility-scoped append-only audit stream." /> : error ? <EmptyState title="Audit records unavailable" body={error} /> : events.length ? events.map((event) => <button className="sv3-audit-event" key={event[5]} onClick={() => onNotify(`${event[5]} expanded with before-and-after values.`)}><time>{event[0]}</time><span className="sv3-audit-dot" /><div><strong>{event[1]}</strong><small>{event[2]} · {event[3]}</small><p>{event[4]}</p><em>Correlation {event[5]}</em></div><b>›</b></button>) : <EmptyState title="No audit events recorded" body="No persisted events exist in the current facility scope." />}</section><aside className="sv3-audit-side"><div className="sv3-surface"><span className="sv3-eyebrow">Access posture</span><strong className="sv3-posture">Protected</strong><p>Identity, facility scope, and permission checks are enforced before sensitive records are returned.</p><div className="sv3-posture-line"><span>Audit retention</span><b>Service status unavailable</b></div><div className="sv3-posture-line"><span>Request IDs</span><b>Enabled by API</b></div><div className="sv3-posture-line"><span>Outbox</span><b>See Notifications</b></div></div><div className="sv3-surface"><span className="sv3-eyebrow">Need to investigate?</span><h2>Open a case</h2><p>Link audit events, appointment records, and evidence access into a controlled review.</p><Button variant="primary" disabled={!events.length} onClick={() => onNotify("Compliance investigation requires a persisted audit event.", "info")}>Start investigation</Button></div></aside></div> : <ComplianceTab tab={tab} onNotify={onNotify} />}</>;
}

type ComplianceSecurityEvent = { id: string; eventType: string; severity: string; requestId: string | null; createdAt: string; metadata?: Record<string, unknown> };

function ComplianceTab({ tab, onNotify }: { tab: string; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [securityEvents, setSecurityEvents] = useState<ComplianceSecurityEvent[]>([]);
  const [auditCount, setAuditCount] = useState<number | null>(null);
  const [financeSummary, setFinanceSummary] = useState<{ credits_purchased?: number; credits_consumed?: number; credits_reserved?: number; refund_cases?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const loadingTimer = window.setTimeout(() => setLoading(true), 0);
    const requests: Promise<void>[] = [];
    if (tab === "Security Events") requests.push(fetch("/api/control/security-events", { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error("SECURITY_EVENTS_UNAVAILABLE"); const body = await response.json() as { events?: ComplianceSecurityEvent[] }; if (active) setSecurityEvents(body.events || []); }));
    if (tab === "Reports") requests.push(fetch("/api/control/reports", { cache: "no-store", credentials: "include", headers: { accept: "application/json" } }).then(async (response) => { if (!response.ok) throw new Error("REPORT_DATA_UNAVAILABLE"); const body = await response.json() as { audit?: { eventCount?: number }; finance?: typeof financeSummary }; if (active) { setAuditCount(body.audit?.eventCount || 0); setFinanceSummary(body.finance || null); } }));
    Promise.all(requests).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(loadingTimer); };
  }, [tab]);
  if (tab === "Recording Access") return <div className="sv3-settings-surface"><Status tone="blue">RECORDING DISABLED</Status><h2>No recording access workflow is active</h2><p>Recording is disabled by the pilot policy. There are no recordings to review, and this workspace does not create fictional access requests.</p></div>;
  if (tab === "Reports") return <div className="sv3-report-grid">{[["Daily operations", auditCount === null ? "Loading" : `${auditCount} audit events loaded`, "Facility-scoped audit activity", auditCount === null ? "LOADING" : "READY"], ["Credit reconciliation", financeSummary ? `${financeSummary.credits_purchased || 0} purchased · ${financeSummary.credits_consumed || 0} consumed` : "Financial records unavailable", "Persisted D1 ledger summary", financeSummary ? "READY" : "UNAVAILABLE"], ["Access review", "Recording policy is OFF", "No recording access records exist", "NOT APPLICABLE"]].map((report) => <div className="sv3-report-card" key={report[0]}><span className="sv3-report-icon">▤</span><strong>{report[0]}</strong><small>{report[1]} · {report[2]}</small><Status tone={report[3] === "READY" ? "green" : report[3] === "NOT APPLICABLE" ? "blue" : "orange"}>{report[3]}</Status><b>{report[3] === "READY" ? "Open report →" : "View status →"}</b></div>)}</div>;
  return <div className="sv3-security-events">{loading ? <div className="sv3-empty"><strong>Loading persisted security events…</strong></div> : securityEvents.length ? securityEvents.map((event) => <div className={`sv3-security-event ${event.severity === "CRITICAL" ? "critical" : ""}`} key={event.id}><span>{event.severity === "CRITICAL" ? "!" : event.severity === "WARNING" ? "!" : "✓"}</span><div><strong>{event.eventType.replaceAll("_", " ")}</strong><small>{new Date(event.createdAt).toLocaleString("en-ID", { timeZone: "Asia/Jakarta" })} · {event.requestId || "No request ID"}</small></div><Status tone={event.severity === "CRITICAL" ? "red" : event.severity === "WARNING" ? "orange" : "green"}>{event.severity}</Status></div>) : <div className="sv3-empty"><strong>No security events recorded</strong><p>The current facility scope has no persisted security events.</p></div>}<Button variant="secondary" onClick={() => onNotify("Security events are read from the current facility scope.")}>Refresh facility scope</Button></div>;
}

type FacilityResource = { id: string; resource_type: string; display_name: string; status: string; room_id: string | null; health_state: string; last_heartbeat_at: string | null; version: number; active_appointment_id: string | null; has_active_kiosk_credential: number; kiosk_credential_last_used_at: string | null };
type FacilityRecord = { id: string; name: string; timezone: string; currentState: string; stateReason: string | null; version: number };

function FacilityPage({ facilityState, onNotify }: { facilityState: string; onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Profile");
  const [facility, setFacility] = useState<FacilityRecord | null>(null);
  const [resources, setResources] = useState<FacilityResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/facility/state", { cache: "no-store" }), fetch("/api/control/resources", { cache: "no-store" })]).then(async ([facilityResponse, resourceResponse]) => {
      const facilityBody = await facilityResponse.json() as { facility?: FacilityRecord; error?: string };
      const resourceBody = await resourceResponse.json() as { resources?: FacilityResource[]; error?: string };
      if (!facilityResponse.ok || !resourceResponse.ok) throw new Error(facilityBody.error || resourceBody.error || "Unable to load facility records.");
      if (active) { setFacility(facilityBody.facility || null); setResources(resourceBody.resources || []); setLoading(false); }
    }).catch((reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : "Unable to load facility records."); setLoading(false); } });
    return () => { active = false; };
  }, []);
  const state = facility?.currentState || facilityState;
  const stateLabel = state.replaceAll("_", " ");
  const rooms = resources.filter((resource) => resource.resource_type === "ROOM");
  const devices = resources.filter((resource) => resource.resource_type === "DEVICE");
  const visible = tab === "Rooms" ? rooms : devices;
  const healthTone = (resource: FacilityResource) => resource.health_state === "HEALTHY" && ["AVAILABLE", "ONLINE"].includes(resource.status) ? "green" : resource.health_state === "FAILED" || resource.status === "OFFLINE" ? "red" : "orange";
  const formatHeartbeat = (value: string | null) => value ? new Date(value).toLocaleString("en-ID", { dateStyle: "medium", timeStyle: "short", timeZone: facility?.timezone || "Asia/Jakarta" }) : "No heartbeat recorded";
  return <><PageHeader eyebrow="Management · Facility configuration" title="Facility" description="Read the current facility identity, operational state, and resource health from authoritative records." /><div className="sv3-facility-layout"><nav className="sv3-facility-nav">{["Profile", "Operating Hours", "Rooms", "Devices", "Restrictions", "Closures", "Visit Policies"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}<b>›</b></button>)}</nav><section className="sv3-facility-editor"><div className="sv3-facility-editor-head"><div><span className="sv3-eyebrow">{facility?.name || "Facility record"}</span><h2>{tab}</h2></div><Status tone={state === "NORMAL_OPERATIONS" ? "green" : "red"}>{stateLabel}</Status></div>{error ? <div className="sv3-settings-surface"><strong>Facility records unavailable</strong><p>{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></div> : tab === "Profile" ? <div className="sv3-facility-profile">{loading ? <div className="sv3-empty"><strong>Loading facility record…</strong></div> : <><div className="sv3-facility-map"><span>{facility?.name?.slice(0, 3).toUpperCase() || "FAC"}</span><small>{facility?.id || "Facility ID unavailable"}</small><i>⌖</i></div><div className="sv3-form-grid"><label>Facility name<input value={facility?.name || ""} readOnly /></label><label>Timezone<input value={facility?.timezone || ""} readOnly /></label><label>Facility reference<input value={facility?.id || ""} readOnly /></label><label>Operational state<input value={stateLabel} readOnly /></label><label>State reason<textarea value={facility?.stateReason || "No active state reason recorded."} readOnly /></label></div></>}</div> : ["Rooms", "Devices"].includes(tab) ? <div className="sv3-facility-table">{loading ? <div className="sv3-empty"><strong>Loading resource health…</strong></div> : visible.length ? visible.map((resource) => <button key={resource.id} onClick={() => onNotify(`${resource.display_name} is a persisted facility resource.`)}><strong>{resource.display_name}</strong><span>{tab === "Devices" ? (resource.room_id ? rooms.find((room) => room.id === resource.room_id)?.display_name || "Assigned room unavailable" : "Unassigned") : `${resource.status} · ${resource.active_appointment_id ? `Appointment ${resource.active_appointment_id}` : "No active appointment"}`}</span><span>{tab === "Devices" ? `Heartbeat · ${formatHeartbeat(resource.last_heartbeat_at)}` : `Version ${resource.version}`}</span><Status tone={healthTone(resource)}>{resource.health_state}</Status><b>→</b></button>) : <div className="sv3-empty"><strong>No {tab.toLowerCase()} records</strong><p>This facility has no persisted resources of this type.</p></div>}</div> : tab === "Visit Policies" ? <VisitPolicyEditor /> : <div className="sv3-settings-surface"><Status tone="orange">NOT CONNECTED</Status><strong>{tab} is not yet backed by a persisted facility configuration workflow.</strong><p>This section is intentionally unavailable until its data model, permissions, history, and operational effects are implemented. Resource health is available in Rooms and Devices.</p><Button onClick={() => setTab("Profile")}>Open an available facility view</Button></div>}</section></div></>;
}

type StaffRecord = { id: string; email: string; display_name: string; status: string; last_login_at: string | null; version: number; employee_reference: string; job_title: string; department: string | null; roles: string | null };

type OutboxFailure = { id: string; event_type: string; aggregate_type: string; aggregate_id: string | null; payload: string; correlation_id: string; status: string; attempt_count: number; available_at: string; last_error: string | null; created_at: string };

function NotificationOperationsPanel({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [events, setEvents] = useState<OutboxFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replaying, setReplaying] = useState("");
  const load = () => { setLoading(true); fetch("/api/control/notifications/outbox", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } }).then(async (response) => { const body = await response.json() as { events?: OutboxFailure[]; error?: string }; if (!response.ok) throw new Error(body.error || "Unable to load notification failures"); setEvents(body.events || []); setError(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load notification failures")).finally(() => setLoading(false)); };
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);
  const replay = async (event: OutboxFailure) => { setReplaying(event.id); try { const response = await fetch("/api/control/notifications/outbox", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `outbox-replay-${crypto.randomUUID()}` }, body: JSON.stringify({ outboxEventId: event.id, reason: "Staff requested retry of failed notification delivery." }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || "Unable to replay notification"); onNotify(`${event.event_type} queued for retry.`, "success"); load(); } catch (reason: unknown) { onNotify(reason instanceof Error ? reason.message : "Unable to replay notification", "error"); } finally { setReplaying(""); } };
  return <div className="sv3-admin-content"><div className="sv3-admin-stat"><span>Delivery exceptions</span><strong>{loading ? "—" : events.length}</strong><small>Facility-scoped failed and dead-letter events · replay is audited</small></div>{error ? <div className="sv3-settings-surface"><Status tone="red">UNAVAILABLE</Status><strong>Notification operations unavailable</strong><p>{error}</p><Button onClick={() => load()}>Try again</Button></div> : loading ? <div className="sv3-empty"><strong>Loading delivery exceptions</strong><p>Reading the persisted notification outbox.</p></div> : !events.length ? <div className="sv3-empty"><Status tone="green">CLEAR</Status><strong>No failed notifications</strong><p>The facility outbox has no failed or dead-letter deliveries requiring staff action.</p></div> : <div className="sv3-staff-list">{events.map((event) => <div className="sv3-notification-failure" key={event.id}><span><strong>{event.event_type}</strong><small>{event.aggregate_type} · {event.aggregate_id || "No aggregate"}</small></span><span><small>{event.attempt_count} attempt{event.attempt_count === 1 ? "" : "s"} · {new Date(event.created_at).toLocaleString()}</small><small>{event.last_error || "No delivery error recorded"}</small></span><Status tone={event.status === "DEAD_LETTER" ? "red" : "orange"}>{event.status}</Status><Button disabled={replaying === event.id} onClick={() => void replay(event)}>{replaying === event.id ? "Queueing…" : "Replay"}</Button></div>)}</div>}</div>;
}

type ReadinessResult = {
  status: "ready" | "not_ready";
  environment: string;
  checks?: {
    database?: boolean;
    schema?: boolean;
    providerConfiguration?: Record<string, boolean>;
    environment?: { ok?: boolean; missing?: string[]; warnings?: string[] };
  };
};

function IntegrationReadinessPanel({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = () => {
    setLoading(true);
    fetch("/api/health/readiness", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as ReadinessResult & { error?: string };
        if (!response.ok && !body.checks) throw new Error(body.error || "Readiness service unavailable.");
        setResult(body);
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Readiness service unavailable."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);
  const checks = result?.checks?.providerConfiguration || {};
  const rows = [
    ["Database", result?.checks?.database],
    ["Schema", result?.checks?.schema],
    ["Payment", checks.payment],
    ["Payment webhooks", checks.paymentWebhook],
    ["Live video", checks.livekit],
    ["Evidence storage", checks.evidenceStorage],
    ["Evidence scanning", checks.evidenceScanning],
    ["Visitor authentication", checks.visitorAuth],
    ["Staff identity", checks.staffIdentity],
    ["Notifications", checks.notifications],
  ] as Array<[string, boolean | undefined]>;
  return <div className="sv3-admin-content"><div className="sv3-admin-stat"><span>Deployment readiness</span><strong>{loading ? "—" : result?.status === "ready" ? "READY" : "ACTION NEEDED"}</strong><small>{result ? `${result.environment.toUpperCase()} environment · checked from the protected readiness API` : "Loading environment checks…"}</small></div>{error ? <div className="sv3-settings-surface"><Status tone="red">UNAVAILABLE</Status><strong>Readiness service unavailable</strong><p>{error}</p><Button onClick={() => load()}>Try again</Button></div> : loading ? <div className="sv3-empty"><strong>Loading integration health</strong><p>Reading the current deployment and facility bindings.</p></div> : <><div className="sv3-control-checks">{rows.map(([label, value]) => <div className="sv3-control-check" key={label}><span>{label}</span><Status tone={value ? "green" : "red"}>{value ? "READY" : "MISSING"}</Status></div>)}</div><div className="sv3-settings-surface"><Status tone={result?.status === "ready" ? "green" : "orange"}>{result?.status === "ready" ? "READY FOR CONFIGURED WORKFLOW" : "NOT READY"}</Status><strong>{result?.status === "ready" ? "Required deployment checks are passing." : "This environment is not ready for institutional traffic."}</strong><p>Missing configuration names and non-secret warnings are shown below. Secret values are never returned to the workspace.</p>{result?.checks?.environment?.missing?.length ? <><span className="sv3-eyebrow">Missing configuration</span><ul>{result.checks.environment.missing.map((item) => <li key={item}>{item}</li>)}</ul></> : null}{result?.checks?.environment?.warnings?.length ? <><span className="sv3-eyebrow">Warnings</span><ul>{result.checks.environment.warnings.map((item) => <li key={item}>{item}</li>)}</ul></> : null}<Button onClick={() => { load(); onNotify("Deployment readiness refreshed from the protected API.", "info"); }}>Refresh readiness</Button></div></>}</div>;
}

function RealAdministrationPage({ onNotify }: { onNotify: (message: string, tone?: Notice["tone"]) => void }) {
  const [tab, setTab] = useState("Staff");
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", displayName: "", employeeReference: "", jobTitle: "", department: "", roleId: "role-scheduling-officer", reason: "Provisioned by the facility supervisor for pilot operations." });
  const [saving, setSaving] = useState(false);
  const load = () => { setLoading(true); fetch("/api/control/staff", { credentials: "include", headers: { accept: "application/json" } }).then(async (response) => { const body = await response.json() as { staff?: StaffRecord[]; error?: string }; if (!response.ok) throw new Error(body.error || "Unable to load staff"); setStaff(body.staff || []); setError(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load staff")).finally(() => setLoading(false)); };
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);
  const provision = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { const response = await fetch("/api/control/staff", { method: "POST", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `staff-provision-${crypto.randomUUID()}` }, body: JSON.stringify(form) }); const body = await response.json() as { error?: string; displayName?: string }; if (!response.ok) throw new Error(body.error || "Provisioning failed"); setForm((current) => ({ ...current, email: "", displayName: "", employeeReference: "", jobTitle: "", department: "" })); onNotify(`${body.displayName || "Staff account"} provisioned. They can now sign in through the configured identity provider.`, "success"); load(); } catch (reason: unknown) { onNotify(reason instanceof Error ? reason.message : "Provisioning failed", "error"); } finally { setSaving(false); } };
  const changeStatus = async (record: StaffRecord) => { const next = record.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"; const response = await fetch("/api/control/staff", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `staff-status-${record.id}-${record.version}-${crypto.randomUUID()}` }, body: JSON.stringify({ userId: record.id, status: next, expectedVersion: record.version, reason: `Supervisor changed ${record.display_name} status for facility access control.` }) }); const body = await response.json() as { error?: string }; if (!response.ok) { onNotify(body.error || "Status update failed", "error"); return; } onNotify(`${record.display_name} is now ${next.toLowerCase()}.`, "success"); load(); };
  return <><div><PageHeader eyebrow="Management · Administration" title="Administration" description="Provision facility staff, assign least-privilege roles, and control access to SecureVisit." actions={tab === "Integrations" ? <span className="sv3-toolbar-meta">Readiness refresh is available below</span> : <Button onClick={() => load()}>Refresh directory</Button>} /><div className="sv3-admin-tabs">{["Staff", "Roles & Permissions", "Notifications", "Integrations", "System Settings"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => { setTab(item); if (item === "System Settings") onNotify("System settings require a facility policy change workflow."); if (item === "Roles & Permissions") onNotify("Role definitions are managed from the controlled provisioning API."); }}>{item}</button>)}</div>{tab === "Notifications" ? <NotificationOperationsPanel onNotify={onNotify} /> : tab === "Integrations" ? <IntegrationReadinessPanel onNotify={onNotify} /> : tab === "Staff" ? <div className="sv3-admin-content"><div className="sv3-admin-stat"><span>Provisioned staff</span><strong>{loading ? "—" : staff.length}</strong><small>Facility-scoped directory · OIDC identities map after first sign-in</small></div><form className="sv3-form-grid" onSubmit={provision}><label>Email address<input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Display name<input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label>Employee reference<input required value={form.employeeReference} onChange={(event) => setForm({ ...form, employeeReference: event.target.value })} /></label><label>Job title<input required value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} /></label><label>Department<input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label><label>Initial role<select value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}><option value="role-scheduling-officer">Scheduling Officer</option><option value="role-verification-officer">Verification Officer</option><option value="role-monitoring-officer">Monitoring Officer</option><option value="role-auditor">Auditor</option><option value="role-supervisor">Supervisor</option></select></label><label className="sv3-form-wide">Reason<textarea required minLength={8} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label><div><Button variant="primary" disabled={saving}>{saving ? "Provisioning…" : "Provision staff account"}</Button></div></form>{error ? <div className="sv3-empty"><strong>Directory unavailable</strong><p>{error}</p><Button onClick={() => load()}>Try again</Button></div> : loading ? <div className="sv3-empty"><strong>Loading staff directory</strong><p>Reading facility-scoped staff records.</p></div> : !staff.length ? <div className="sv3-empty"><strong>No staff provisioned</strong><p>Create the first facility-scoped staff account above.</p></div> : <div className="sv3-staff-list">{staff.map((record) => <button key={record.id} onClick={() => changeStatus(record)}><Avatar initials={record.display_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()} tone="blue" /><span><strong>{record.display_name}</strong><small>{record.job_title} · {record.roles || "No role"}</small></span><span>{record.last_login_at ? `Last login · ${new Date(record.last_login_at).toLocaleDateString()}` : "Never signed in"}</span><Status tone={record.status === "ACTIVE" ? "green" : "red"}>{record.status}</Status><b>→</b></button>)}</div>}</div> : <div className="sv3-settings-surface"><Status tone="orange">NOT CONNECTED</Status><strong>{tab} is not yet backed by a persisted configuration workflow.</strong><p>This section remains intentionally unavailable until its data model, permissions, and operational effects are implemented.</p><Button onClick={() => setTab("Staff")}>Open staff directory</Button></div>}</div></>;
}
