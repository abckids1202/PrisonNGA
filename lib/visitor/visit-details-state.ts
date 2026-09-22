export type VisitorVisitViewState = "review" | "approved" | "waiting" | "ready" | "live" | "completed" | "cancelled" | "rejected" | "issue";

export type VisitorVisitStateInput = {
  status: string;
  session_status: string | null;
  waiting_room_state: string | null;
};

export function getVisitorVisitViewState(appointment: VisitorVisitStateInput): VisitorVisitViewState {
  if (appointment.session_status === "CONNECTING") return "ready";
  if (["ACTIVE", "RECONNECTING", "ENDING"].includes(appointment.session_status || "")) return "live";
  if (appointment.status === "COMPLETED" || appointment.session_status === "ENDED") return "completed";
  if (["CANCELLED_BY_FACILITY", "CANCELLED_BY_VISITOR"].includes(appointment.status) || appointment.session_status === "CANCELLED") return "cancelled";
  if (appointment.status === "REJECTED") return "rejected";
  if (["FAILED", "TECHNICAL_FAILURE", "NO_SHOW"].includes(appointment.status)
    || ["FAILED", "TERMINATED"].includes(appointment.session_status || "")
    || appointment.waiting_room_state === "TECHNICAL_ISSUE") return "issue";
  if (["SUBMITTED", "UNDER_REVIEW"].includes(appointment.status)) return "review";
  if (appointment.status === "WAITING") return "waiting";
  if (appointment.status === "APPROVED") return "approved";
  return "issue";
}
