"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button, SectionLabel, SecureVisitLogo } from "./components/ControlPrimitives";
import LiveSessionsPage from "./features/live-session/LiveSessionsPage";
import ResourcesPage from "./features/resources/ResourcesPage";
import FacilityPage from "./features/management/FacilityPage";
import CompliancePageInteractive from "./features/management/CompliancePageInteractive";
import FinancePage from "./features/management/FinancePage";
import AdministrationPage from "./features/management/AdministrationPage";
import VisitationPage from "./features/management/VisitationPage";
import PeoplePage from "./features/management/PeoplePage";
import CommandPalette from "./features/control/CommandPalette";
import AppointmentsPage from "./features/control/AppointmentsPage";
import CommandCenterPage from "./features/control/CommandCenterPage";
import WaitingRoomPage from "./features/control/WaitingRoomPage";
import IncidentsPage from "./features/control/IncidentsPage";
import { ImpactDialog } from "./features/control/DecisionDialogs";
import AppointmentDrawer from "./features/control/AppointmentDrawer";
import ContextDrawer, { type DrawerPayload } from "./features/control/ContextDrawer";
import { mapBackendAppointment, type Appointment, type AppointmentStatus } from "./features/control/model";
import { formatDateValue as formatDateValueWithZone, safeTimeZone } from "@/lib/date-format";

const formatDateValue = formatDateValueWithZone;

type Mode = "operations" | "management";
type RuntimeEnvironment = "development" | "staging" | "production" | "unknown";
type Notice = { id: number; message: string; tone?: "success" | "warning" | "error" | "info" };
type SecurityNotification = { id: string; eventType: string; severity: string; createdAt: string; requestId?: string | null };
type StaffShellIdentity = { displayName?: string; userType?: string; scope?: { facilityName?: string; jobTitle?: string } | null };
type ResourceReassignment = { appointmentId: string; sourceResourceId: string; targetResourceId: string; expectedSourceVersion: number; expectedTargetVersion: number; expectedWaitingVersion: number; reason: string };
type PopoverKind = "capacity" | "waiting" | "session" | "demo" | null;
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


export default function ControlApp() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("operations");
  const [page, setPage] = useState("Command Center");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [facilityState, setFacilityState] = useState("UNKNOWN");
  const [facilityVersion, setFacilityVersion] = useState(1);
  const [facilityName, setFacilityName] = useState("Facility workspace");
  const [facilityTimezone, setFacilityTimezone] = useState("Asia/Jakarta");
  const [backendStatus, setBackendStatus] = useState<"connected" | "unavailable">("unavailable");
  const [runtimeEnvironment, setRuntimeEnvironment] = useState<RuntimeEnvironment>("unknown");
  const [simulationPaused, setSimulationPaused] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [resourceToFocus, setResourceToFocus] = useState<string | null>(null);
  const [selectedDrawer, setSelectedDrawer] = useState<DrawerPayload | null>(null);
  const [approvalAppointment, setApprovalAppointment] = useState<Appointment | null>(null);
  const [popover, setPopover] = useState<PopoverKind>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [securityNotifications, setSecurityNotifications] = useState<SecurityNotification[]>([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState(false);
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
    const loadAppointments = async () => {
      try {
        const response = await fetch("/api/control/appointments", { headers: { accept: "application/json" }, credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error("APPOINTMENTS_UNAVAILABLE");
        const body = await response.json() as { appointments?: Array<{ id: string; visitor_name?: string; prisoner_name?: string; requested_start: string; requested_end: string; timezone?: string | null; appointment_type?: string; status: string; version?: number; room_name?: string | null; kiosk_name?: string | null; relationship_type?: string | null; relationship_status?: string | null; prisoner_status?: string | null; visitation_status?: string | null; facility_state?: string | null; available_credits?: number; reserved_credits?: number; active_credit_reservation?: number }> };
        if (!active) return;
        setAppointments((body.appointments || []).map(mapBackendAppointment));
        setBackendStatus("connected");
      } catch {
        if (active) setBackendStatus("unavailable");
      }
    };
    void loadAppointments();
    const timer = window.setInterval(() => { void loadAppointments(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const loadFacilityState = async () => {
      try {
        const response = await fetch("/api/facility/state", { headers: { accept: "application/json" }, credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error("FACILITY_STATE_UNAVAILABLE");
        const body = await response.json() as { facility?: { name?: string; timezone?: string; currentState: string; version: number } };
        if (active && body.facility) {
          setFacilityName(body.facility.name || "Facility workspace");
          setFacilityTimezone(safeTimeZone(body.facility.timezone));
          setFacilityState(body.facility.currentState);
          setFacilityVersion(body.facility.version);
          setBackendStatus("connected");
        }
      } catch {
        if (active) setBackendStatus("unavailable");
      }
    };
    void loadFacilityState();
    const timer = window.setInterval(() => { void loadFacilityState(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  function notify(message: string, tone: Notice["tone"] = "info") {
    const id = Date.now();
    setNotices((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 4200);
  }

  async function openNotifications() {
    const nextOpen = !notificationPanelOpen;
    setNotificationPanelOpen(nextOpen);
    if (!nextOpen) return;
    setNotificationLoading(true);
    setNotificationError(false);
    try {
      const response = await fetch("/api/control/security-events", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("SECURITY_NOTIFICATIONS_UNAVAILABLE");
      const body = await response.json() as { events?: SecurityNotification[] };
      setSecurityNotifications(Array.isArray(body.events) ? body.events.slice(0, 8) : []);
    } catch {
      setSecurityNotifications([]);
      setNotificationError(true);
    } finally {
      setNotificationLoading(false);
    }
  }

  async function changeFacilityState(nextState: string, reason?: string) {
    if (facilityState === "UNKNOWN" || backendStatus !== "connected") {
      throw new Error("The facility state cannot change until the protected facility record is available.");
    }
    const response = await fetch("/api/facility/state", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `facility-state:${nextState}:${facilityVersion}` }, body: JSON.stringify({ state: nextState, expectedVersion: facilityVersion, reason: reason || (nextState === "LOCKDOWN" ? "Staff supervisor declared a controlled facility lockdown." : "Staff supervisor restored normal operations.") }) });
    if (!response.ok) throw new Error("The protected staff API rejected the facility state change.");
    const body = await response.json() as { facility?: { version?: number } };
    setFacilityState(nextState);
    setFacilityVersion(body.facility?.version || facilityVersion + 1);
    setBackendStatus("connected");
  }

  async function updateAppointment(id: string, status: AppointmentStatus, commandOverride?: "approve" | "reject" | "request_info" | "cancel" | "no_show") {
    const command = commandOverride || (status === "Approved" ? "approve" : status === "Blocked" ? "reject" : "request_info");
    try {
      const appointment = appointments.find((item) => item.id === id);
      if (!appointment || !Number.isSafeInteger(appointment.version)) throw new Error("APPOINTMENT_VERSION_UNAVAILABLE");
      const response = await fetch("/api/control/appointments", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `appointment-decision-${id}-${command}-${appointment.version}` }, credentials: "include", body: JSON.stringify({ appointmentId: id, command, expectedVersion: appointment.version, reason: `Staff selected ${command.replaceAll("_", " ")} from the appointment review workflow.` }) });
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
      const response = await fetch("/api/control/resources", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Idempotency-Key": `resource-reassign:${input.appointmentId}:${input.sourceResourceId}:${input.expectedSourceVersion}:${input.targetResourceId}:${input.expectedTargetVersion}:${input.expectedWaitingVersion}` }, credentials: "include", body: JSON.stringify({
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
    if (payload.kind === "device") setSelectedDrawer({ kind: "device", deviceId: payload.deviceId, deviceLabel: payload.deviceLabel });
    else if (payload.kind === "waiting") setSelectedDrawer({ kind: "waiting", visitId: payload.visitId, visitorLabel: payload.visitorLabel });
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

  function openResource(resourceId: string) {
    setResourceToFocus(resourceId);
    navigate("Resources", "operations");
  }

  const currentNav = mode === "operations" ? operationsNav : managementNav;
  const pageContent = mode === "operations" ? renderOperationsPage() : renderManagementPage();

  function renderOperationsPage() {
    if (page === "Appointments") return <AppointmentsPage appointments={appointments} onSelect={setSelectedAppointment} onNotify={notify} />;
    if (page === "Waiting Room") return <WaitingRoomPage facilityState={facilityState} onNotify={notify} />;
    if (page === "Live Sessions") return <LiveSessionsPage timeZone={facilityTimezone} onNotify={notify} />;
    if (page === "Resources") return <ResourcesPage initialResourceId={resourceToFocus} timeZone={facilityTimezone} onNotify={notify} onReassign={reassignAppointment} />;
    if (page === "Incidents") return <IncidentsPage timeZone={facilityTimezone} onNotify={notify} />;
    return <CommandCenterPage appointments={appointments} facilityName={facilityName} facilityTimezone={facilityTimezone} now={now} facilityState={facilityState} backendStatus={backendStatus} demoMode={runtimeEnvironment === "development"} simulationPaused={simulationPaused} simulationTick={simulationTick} onFacilityStateChange={changeFacilityState} onPause={() => setSimulationPaused((current) => !current)} onAdvance={() => { setSimulationTick((current) => current + 1); notify("Development simulation advanced locally; no facility record changed.", "info"); }} onNavigate={navigate} onOpenDrawer={openDrawer} onOpenAppointment={setSelectedAppointment} onOpenPopover={(kind) => setPopover((current) => current === kind ? null : kind)} onNotify={notify} popover={popover} />;
  }

  function renderManagementPage() {
    if (page === "People") return <PeoplePage timeZone={facilityTimezone} onNotify={notify} />;
    if (page === "Visitation") return <VisitationPage timeZone={facilityTimezone} />;
    if (page === "Finance") return <FinancePage timeZone={facilityTimezone} onNotify={notify} />;
    if (page === "Compliance") return <CompliancePageInteractive timeZone={facilityTimezone} onNotify={notify} onNavigate={navigate} />;
    if (page === "Facility") return <FacilityPage facilityState={facilityState} onFacilityStateChange={changeFacilityState} onOpenResource={openResource} onNotify={notify} />;
    return <AdministrationPage timeZone={facilityTimezone} onNotify={notify} />;
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
      <div className="sv3-topbar"><div className="sv3-breadcrumb"><span>SecureVisit Control</span><i>/</i><strong>{mode === "operations" ? "Operations" : "Management"}</strong><i>/</i><strong>{page}</strong></div><div className="sv3-top-actions"><button type="button" className="sv3-demo-badge" aria-label={`Runtime environment: ${runtimeEnvironment}`} onClick={() => runtimeEnvironment === "development" && setPopover(popover === "demo" ? null : "demo")}><i />{runtimeEnvironment === "unknown" ? "CHECKING ENVIRONMENT" : `${runtimeEnvironment.toUpperCase()} ENVIRONMENT`}</button><span className="sv3-clock" suppressHydrationWarning>{formatDateValue(now, { dateStyle: "medium", timeStyle: "short" }, facilityTimezone, "Time unavailable")} {facilityTimezone}</span><button className="sv3-icon-button" aria-label="Open command palette" onClick={() => setCommandOpen(true)}>⌕</button><button className="sv3-visitor-link" aria-label="Open Visitor Portal" onClick={() => router.push("/visitor")}><span>↗</span> Visitor Portal</button><button className={`sv3-icon-button ${notificationPanelOpen ? "active" : ""}`} aria-label="Notifications" aria-expanded={notificationPanelOpen} onClick={() => void openNotifications()}>◔</button></div></div>
      <div className="sv3-page-scroll">{pageContent}</div>{notificationPanelOpen ? <div className="sv3-top-popover sv3-notification-popover" role="dialog" aria-label="Security notifications"><header><strong>Security notifications</strong><button type="button" aria-label="Close notifications" onClick={() => setNotificationPanelOpen(false)}>×</button></header>{notificationLoading ? <p>Loading facility security events…</p> : notificationError ? <p role="alert">Security events are unavailable. No empty notification state is being inferred.</p> : securityNotifications.length ? securityNotifications.map((event) => <button type="button" className="sv3-notification-row" key={event.id} onClick={() => { setNotificationPanelOpen(false); navigate("Compliance", "management"); }}><span className={event.severity === "CRITICAL" ? "critical" : event.severity === "WARNING" ? "warning" : ""}>{event.severity === "CRITICAL" ? "!" : event.severity === "WARNING" ? "!" : "✓"}</span><strong>{event.eventType.replaceAll("_", " ")}</strong><small>{formatDateValue(event.createdAt, { dateStyle: "medium", timeStyle: "short" }, facilityTimezone, "Date unavailable")}</small></button>) : <p>No security events recorded for this facility.</p>}</div> : null}
    </main>
    {runtimeEnvironment === "development" && popover === "demo" ? <div className="sv3-top-popover"><span className="sv3-eyebrow">Development environment</span><strong>Local simulation controls are enabled</strong><span>Scenario · Normal day</span><span>Simulation · {simulationPaused ? "Paused" : "Running"}</span><Button variant="quiet" onClick={() => { setPopover(null); notify("Development simulation reset. No facility record changed."); }}>Reset simulation</Button></div> : null}
    <div className="sv3-toasts" aria-live="polite">{notices.map((notice) => <div key={notice.id} className={`sv3-toast sv3-toast-${notice.tone || "info"}`} role="status"><i>{notice.tone === "error" ? "×" : notice.tone === "warning" ? "!" : notice.tone === "success" ? "✓" : "•"}</i><span>{notice.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}>×</button></div>)}</div>
    {selectedAppointment ? <AppointmentDrawer appointment={selectedAppointment} onClose={() => setSelectedAppointment(null)} onRequestApproval={() => setApprovalAppointment(selectedAppointment)} onUpdate={updateAppointment} /> : null}
    {selectedDrawer ? <ContextDrawer payload={selectedDrawer} onClose={() => setSelectedDrawer(null)} onOpenAppointment={(appointment) => { setSelectedDrawer(null); setSelectedAppointment(appointment); }} onRequestApproval={(appointment) => { setSelectedDrawer(null); setApprovalAppointment(appointment); }} /> : null}
    {approvalAppointment ? <ImpactDialog appointment={approvalAppointment} onClose={() => setApprovalAppointment(null)} onConfirm={() => updateAppointment(approvalAppointment.id, "Approved")} /> : null}
    {commandOpen ? <CommandPalette appointments={appointments} onClose={() => setCommandOpen(false)} onOpenAppointment={(appointment) => { setCommandOpen(false); setSelectedAppointment(appointment); }} onNavigate={(nextPage) => { setCommandOpen(false); navigate(nextPage); }} /> : null}
  </div>;
}

