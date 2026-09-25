import { getD1 } from "../../../db/runtime";
import { requireVisitorIdentity, SecurityError } from "../../../lib/server/security";

export type SessionRecord = {
  id: string;
  appointment_id: string;
  facility_id: string;
  visitor_user_id: string;
  visitor_name: string;
  prisoner_name: string;
  prisoner_id: string;
  appointment_status: string;
  appointment_version: number;
  prisoner_status?: string;
  visitation_status?: string;
  facility_state?: string;
  status: string;
  provider: string;
  provider_room_name: string;
  authorized_start_at: string;
  authorized_end_at: string;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  termination_reason: string | null;
  recording_policy: string;
  recording_status: string;
  version: number;
};

export async function getVisitorSession(visitId: string, allowTerminal = false): Promise<SessionRecord> {
  const visitor = await requireVisitorIdentity();
  const d1 = await getD1();
  const record = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, a.visitor_user_id, u.display_name AS visitor_name, p.display_name AS prisoner_name, a.prisoner_id, a.status AS appointment_status, a.version AS appointment_version,
      p.status AS prisoner_status, p.visitation_status, f.current_state AS facility_state,
      vs.status, vs.provider, vs.provider_room_name, vs.authorized_start_at, vs.authorized_end_at, vs.actual_started_at, vs.actual_ended_at, vs.termination_reason, vs.recording_policy, vs.recording_status, vs.version
    FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id INNER JOIN users u ON u.id = a.visitor_user_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
      INNER JOIN facilities f ON f.id = a.facility_id
    WHERE vs.appointment_id = ? AND a.visitor_user_id = ?`).bind(visitId, visitor.userId).first<SessionRecord>();
  if (!record) throw new SecurityError("VISIT_NOT_FOUND", 404);
  if (!allowTerminal) assertVisitorJoinAllowed(record);
  return record;
}

export async function getStaffSession(sessionId: string, facilityId: string): Promise<SessionRecord> {
  const d1 = await getD1();
  const record = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, a.visitor_user_id, u.display_name AS visitor_name, p.display_name AS prisoner_name, a.prisoner_id, a.status AS appointment_status, a.version AS appointment_version,
      vs.status, vs.provider, vs.provider_room_name, vs.authorized_start_at, vs.authorized_end_at, vs.actual_started_at, vs.actual_ended_at, vs.termination_reason, vs.recording_policy, vs.recording_status, vs.version
    FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id INNER JOIN users u ON u.id = a.visitor_user_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
    WHERE vs.id = ? AND vs.facility_id = ?`).bind(sessionId, facilityId).first<SessionRecord>();
  if (!record) throw new SecurityError("SESSION_NOT_FOUND", 404);
  return record;
}

export function assertJoinable(record: SessionRecord): void {
  assertRecordingDisabled(record);
  if (!["CONNECTING", "ACTIVE", "RECONNECTING"].includes(record.status)) {
    if (["ENDED", "TERMINATED", "CANCELLED"].includes(record.status)) throw new SecurityError("SESSION_ENDED", 409);
    throw new SecurityError("SESSION_NOT_READY", 409);
  }
  const start = Date.parse(record.authorized_start_at);
  const end = Date.parse(record.authorized_end_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new SecurityError("SESSION_INVALID_WINDOW", 409);
  if (Date.now() < start - 60_000) throw new SecurityError("SESSION_NOT_STARTED", 409);
  if (Date.now() > end + 60_000) throw new SecurityError("SESSION_EXPIRED", 409);
}

/**
 * Recording is intentionally unavailable for the institutional pilot. Treat
 * any legacy, malformed, or future-enabled row as non-joinable until a
 * separately approved recording workflow exists.
 */
export function assertRecordingDisabled(record: Pick<SessionRecord, "recording_policy" | "recording_status">): void {
  if (record.recording_policy !== "OFF" || record.recording_status !== "NOT_RECORDED") {
    throw new SecurityError("RECORDING_POLICY_NOT_ALLOWED", 409);
  }
}

/**
 * Keep the provider credential within the server-authorized visit window.
 * The extra minute covers clock skew and the existing join grace period;
 * the room is still terminated by the server-side session finalizer.
 */
export function sessionTokenTtlSeconds(record: Pick<SessionRecord, "authorized_end_at">): number {
  const end = Date.parse(record.authorized_end_at);
  if (!Number.isFinite(end)) throw new SecurityError("SESSION_INVALID_WINDOW", 409);
  return Math.max(60, Math.min(30 * 60, Math.ceil((end - Date.now()) / 1000) + 60));
}

export function assertVisitorJoinAllowed(record: SessionRecord): void {
  assertJoinable(record);
  if (record.appointment_status !== "IN_PROGRESS") throw new SecurityError("APPOINTMENT_NOT_IN_PROGRESS", 409);
  if (record.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
  if (record.prisoner_status !== "ACTIVE" || record.visitation_status !== "APPROVED") throw new SecurityError("PRISONER_NOT_AVAILABLE", 409);
}

export function assertStaffObserverJoinAllowed(record: SessionRecord): void {
  assertJoinable(record);
  if (record.appointment_status !== "IN_PROGRESS") throw new SecurityError("SESSION_NOT_AVAILABLE", 409);
}

export function toSessionPayload(record: SessionRecord) {
  return {
    id: record.id,
    visitId: record.appointment_id,
    status: record.status,
    appointmentStatus: record.appointment_status,
    provider: record.provider,
    authorizedStartAt: record.authorized_start_at,
    authorizedEndAt: record.authorized_end_at,
    actualStartedAt: record.actual_started_at,
    actualEndedAt: record.actual_ended_at,
    recordingPolicy: record.recording_policy,
    recordingStatus: record.recording_status,
    visitorName: record.visitor_name,
    prisonerName: record.prisoner_name,
  };
}
