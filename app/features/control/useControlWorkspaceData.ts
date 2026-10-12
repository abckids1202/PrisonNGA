import { useEffect, useState } from "react";
import { mapBackendAppointment, type Appointment } from "./model";
import { safeTimeZone } from "@/lib/date-format";

export type RuntimeEnvironment = "development" | "staging" | "production" | "unknown";
export type SecurityNotification = { id: string; eventType: string; severity: string; createdAt: string; requestId?: string | null };
export type StaffShellIdentity = { displayName?: string; userType?: string; scope?: { facilityName?: string; jobTitle?: string } | null };

export function useControlWorkspaceData() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [facilityState, setFacilityState] = useState("UNKNOWN");
  const [facilityVersion, setFacilityVersion] = useState(1);
  const [facilityName, setFacilityName] = useState("Facility workspace");
  const [facilityTimezone, setFacilityTimezone] = useState("Asia/Jakarta");
  const [backendStatus, setBackendStatus] = useState<"connected" | "unavailable">("unavailable");
  const [runtimeEnvironment, setRuntimeEnvironment] = useState<RuntimeEnvironment>("unknown");
  const [securityNotifications, setSecurityNotifications] = useState<SecurityNotification[]>([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState(false);
  const [staffIdentity, setStaffIdentity] = useState<StaffShellIdentity | null>(null);
  const [now, setNow] = useState(() => new Date());

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

  async function openNotifications() {
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

  return {
    appointments, setAppointments,
    facilityState, setFacilityState,
    facilityVersion, setFacilityVersion,
    facilityName, facilityTimezone,
    backendStatus, setBackendStatus,
    runtimeEnvironment,
    securityNotifications, notificationLoading, notificationError,
    staffIdentity, now,
    openNotifications,
  };
}
