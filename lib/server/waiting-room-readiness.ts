export type WaitingCheckState = "pass" | "warning" | "failed" | "pending";
export type WaitingRoomReadinessState = "NOT_ARRIVED" | "VISITOR_WAITING" | "PRISONER_WAITING" | "BOTH_PRESENT" | "TECHNICAL_ISSUE" | "STAFF_REVIEW" | "READY_TO_START";

export type WaitingRoomReadinessFacts = {
  visitorPresence: string | null;
  prisonerPresence: string | null;
  relationshipStatus: string | null;
  prisonerStatus: string | null;
  visitationStatus: string | null;
  facilityState: string | null;
  visitorCameraResult: string | null;
  visitorMicrophoneResult: string | null;
  visitorNetworkResult: string | null;
  visitorLatencyMs: number | null;
  visitorDeviceCheckedAt: string | null;
  roomReserved: boolean;
  roomStatus: string | null;
  roomHealth: string | null;
  kioskReserved: boolean;
  kioskStatus: string | null;
  kioskHealth: string | null;
  kioskHeartbeatAt: string | null;
  kioskCredentialActive: boolean;
};

export type WaitingRoomReadiness = {
  state: WaitingRoomReadinessState;
  readyToStart: boolean;
  checks: {
    identity: WaitingCheckState;
    camera: WaitingCheckState;
    microphone: WaitingCheckState;
    network: WaitingCheckState;
    room: WaitingCheckState;
    kiosk: WaitingCheckState;
    restriction: WaitingCheckState;
  };
};

const DEVICE_CHECK_MAX_AGE_MS = 20 * 60_000;
const KIOSK_HEARTBEAT_MAX_AGE_MS = 3 * 60_000;

function isRecent(timestamp: string | null, now: number, maxAgeMs: number): boolean {
  if (!timestamp) return false;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time <= now && now - time <= maxAgeMs;
}

function deviceResult(result: string | null, fresh: boolean): WaitingCheckState {
  if (!fresh || result === null) return "pending";
  if (result === "ready") return "pass";
  if (result === "warning") return "warning";
  if (result === "failed") return "failed";
  return "pending";
}

export function evaluateWaitingRoomReadiness(
  facts: WaitingRoomReadinessFacts,
  now = Date.now(),
): WaitingRoomReadiness {
  const visitorPresent = facts.visitorPresence === "present";
  const prisonerPresent = facts.prisonerPresence === "present";
  const eligible = facts.prisonerStatus === "ACTIVE" && facts.visitationStatus === "APPROVED";
  const freshDeviceCheck = isRecent(facts.visitorDeviceCheckedAt, now, DEVICE_CHECK_MAX_AGE_MS);
  const freshKioskHeartbeat = isRecent(facts.kioskHeartbeatAt, now, KIOSK_HEARTBEAT_MAX_AGE_MS);
  const checks: WaitingRoomReadiness["checks"] = {
    identity: facts.relationshipStatus === "APPROVED" && eligible ? "pass" : "failed",
    camera: deviceResult(facts.visitorCameraResult, freshDeviceCheck),
    microphone: deviceResult(facts.visitorMicrophoneResult, freshDeviceCheck),
    network: !freshDeviceCheck || !facts.visitorNetworkResult || facts.visitorNetworkResult === "unknown"
      ? "pending"
      : ["stable", "fair"].includes(facts.visitorNetworkResult) && facts.visitorLatencyMs !== null && facts.visitorLatencyMs <= 650
        ? "pass"
        : "failed",
    room: !facts.roomReserved
      ? "pending"
      : facts.roomStatus === "AVAILABLE" && facts.roomHealth === "HEALTHY" ? "pass" : "failed",
    kiosk: !facts.kioskReserved
      ? "pending"
      : facts.kioskStatus === "ONLINE" && facts.kioskHealth === "HEALTHY" && freshKioskHeartbeat && facts.kioskCredentialActive
        ? "pass"
        : "failed",
    restriction: facts.facilityState === "NORMAL_OPERATIONS" && eligible ? "pass" : "failed",
  };

  const allChecksPass = Object.values(checks).every((state) => state === "pass");
  const bothPresent = visitorPresent && prisonerPresent;
  let state: WaitingRoomReadinessState;
  if (bothPresent && allChecksPass) {
    state = "READY_TO_START";
  } else if (checks.identity === "failed" || checks.room === "failed" || checks.restriction === "failed") {
    state = "STAFF_REVIEW";
  } else if (visitorPresent) {
    state = "VISITOR_WAITING";
  } else if (prisonerPresent) {
    state = "PRISONER_WAITING";
  } else {
    state = "NOT_ARRIVED";
  }
  if (bothPresent && !allChecksPass && (checks.camera === "failed" || checks.microphone === "failed" || checks.network === "failed" || checks.kiosk === "failed")) {
    state = "TECHNICAL_ISSUE";
  } else if (bothPresent && !allChecksPass && state !== "STAFF_REVIEW") {
    state = "BOTH_PRESENT";
  }

  return { state, readyToStart: state === "READY_TO_START", checks };
}
