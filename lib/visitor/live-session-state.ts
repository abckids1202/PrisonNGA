export type PersistedSessionOutcome = "COMPLETED" | "FAILED" | "CANCELLED";

export type SessionPersonNames = {
  visitorName: string;
  prisonerName: string;
};

export type LiveSessionViewStage = "loading" | "connecting" | "active" | "reconnecting" | "confirming" | "ended" | "left" | "error";

export function liveSessionOutcome(sessionStatus: string, appointmentStatus: string): PersistedSessionOutcome | null {
  if (sessionStatus === "ENDED" && appointmentStatus === "COMPLETED") return "COMPLETED";
  if (["FAILED", "TERMINATED"].includes(sessionStatus) || appointmentStatus === "TECHNICAL_FAILURE") return "FAILED";
  if (["CANCELLED_BY_VISITOR", "CANCELLED_BY_FACILITY"].includes(appointmentStatus) || sessionStatus === "CANCELLED") return "CANCELLED";
  return null;
}

export function remoteSessionPerson(role: "VISITOR" | "FACILITY", people: SessionPersonNames): string {
  return role === "VISITOR" ? people.prisonerName : people.visitorName;
}

export function nextLiveSessionViewStage(
  current: LiveSessionViewStage,
  input: { remainingSeconds?: number; connectionDisconnected?: boolean; scheduledTimeEnded?: boolean; persistedOutcome?: PersistedSessionOutcome | null },
): LiveSessionViewStage {
  if (input.persistedOutcome) return "ended";
  if (["ended", "left", "error"].includes(current)) return current;
  if (input.connectionDisconnected) return input.scheduledTimeEnded ? "confirming" : "reconnecting";
  if ((input.remainingSeconds ?? 1) <= 0 && ["active", "reconnecting"].includes(current)) return "confirming";
  return current;
}
