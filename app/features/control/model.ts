export type AppointmentStatus = "Requires action" | "Ready" | "Live" | "Blocked" | "Completed" | "Approved";
export type WaitingState = "NOT_ARRIVED" | "VISITOR_WAITING" | "PRISONER_WAITING" | "BOTH_PRESENT" | "TECHNICAL_ISSUE" | "STAFF_REVIEW" | "READY_TO_START" | "LATE" | "LIVE" | "COMPLETED" | "NO_SHOW";
export type CheckState = "pass" | "warning" | "failed" | "pending";
export type ReadinessCheck = { key: string; label: string; detail: string; state: CheckState };

export type Appointment = {
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
  timezone?: string;
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

export type WaitingRecord = Appointment & {
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

export function mapBackendAppointment(row: {
  id: string;
  visitor_name?: string;
  prisoner_name?: string;
  requested_start: string;
  requested_end: string;
  timezone?: string | null;
  appointment_type?: string;
  status: string;
  version?: number;
  created_at?: string;
  updated_at?: string;
  room_name?: string | null;
  kiosk_name?: string | null;
  relationship_type?: string | null;
  relationship_status?: string | null;
  prisoner_status?: string | null;
  visitation_status?: string | null;
  facility_state?: string | null;
  available_credits?: number;
  reserved_credits?: number;
  active_credit_reservation?: number;
}): Appointment {
  const start = new Date(row.requested_start);
  const end = new Date(row.requested_end);
  const status: AppointmentStatus = row.status === "APPROVED" ? "Approved" : row.status === "WAITING" ? "Ready" : row.status === "IN_PROGRESS" ? "Live" : row.status === "COMPLETED" ? "Completed" : ["REJECTED", "CANCELLED_BY_FACILITY", "CANCELLED_BY_VISITOR", "FAILED", "NO_SHOW"].includes(row.status) ? "Blocked" : ["SUBMITTED", "UNDER_REVIEW"].includes(row.status) ? "Requires action" : "Ready";
  const visitor = row.visitor_name || "Visitor name unavailable";
  const prisoner = row.prisoner_name || "Prisoner name unavailable";
  const timeZone = row.timezone || "Asia/Jakarta";
  const time = (value: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(value);
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone }).format(start);
  return { id: row.id, visitor, visitorInitials: visitor.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), prisoner, time: `${time(start)}–${time(end)}`, date, room: row.room_name || "Unassigned", kiosk: row.kiosk_name || "Unassigned", type: row.appointment_type === "LEGAL" ? "Legal" : "Family", status, rawStatus: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, requestedStart: row.requested_start, requestedEnd: row.requested_end, timezone: row.timezone || "Asia/Jakarta", relationshipType: row.relationship_type, relationshipStatus: row.relationship_status, prisonerStatus: row.prisoner_status, visitationStatus: row.visitation_status, facilityState: row.facility_state, availableCredits: row.available_credits, reservedCredits: row.reserved_credits, activeCreditReservation: row.active_credit_reservation === 1, issue: status === "Requires action" ? "Visitor request awaits staff review" : undefined };
}
