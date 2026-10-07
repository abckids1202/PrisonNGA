export type VisitorVisitViewState = "review" | "approved" | "waiting" | "ready" | "live" | "completed" | "cancelled" | "rejected" | "issue";

export type VisitorVisitStateInput = {
  status: string;
  session_status: string | null;
  waiting_room_state: string | null;
};

export function getVisitorVisitViewState(appointment: VisitorVisitStateInput): VisitorVisitViewState {
  // Appointment status is the authoritative terminal boundary. A stale
  // provider/session row must never make a cancelled visit joinable, and a
  // completed visit is only complete once its session is also ended.
  if (["CANCELLED_BY_FACILITY", "CANCELLED_BY_VISITOR"].includes(appointment.status)) return "cancelled";
  if (appointment.status === "REJECTED") return "rejected";
  if (["FAILED", "TECHNICAL_FAILURE", "NO_SHOW"].includes(appointment.status)
    || ["CANCELLED", "FAILED", "TERMINATED"].includes(appointment.session_status || "")
    || appointment.waiting_room_state === "TECHNICAL_ISSUE") return "issue";
  if (appointment.status === "COMPLETED") return appointment.session_status === "ENDED" ? "completed" : "issue";
  if (["ACTIVE", "RECONNECTING", "ENDING"].includes(appointment.session_status || "")) return "live";
  if (appointment.session_status === "CONNECTING") return "ready";
  if (["SUBMITTED", "UNDER_REVIEW"].includes(appointment.status)) return "review";
  if (appointment.status === "WAITING") return "waiting";
  if (appointment.status === "APPROVED") return "approved";
  return "issue";
}
