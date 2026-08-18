import { getD1 } from "../../../db/runtime";
import { getWorkspaceIdentity, SecurityError } from "../../../lib/server/security";

export type SessionRecord = {
  id: string;
  appointment_id: string;
  facility_id: string;
  visitor_user_id: string;
  visitor_name: string;
  prisoner_id: string;
  appointment_status: string;
  status: string;
  provider: string;
  provider_room_name: string;
  authorized_start_at: string;
  authorized_end_at: string;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  recording_policy: string;
  recording_status: string;
  version: number;
};

export async function getVisitorSession(visitId: string): Promise<SessionRecord> {
  const identity = await getWorkspaceIdentity();
  if (!identity) throw new SecurityError("AUTHENTICATION_REQUIRED", 401);
  const d1 = await getD1();
  const record = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, a.visitor_user_id, u.display_name AS visitor_name, a.prisoner_id, a.status AS appointment_status,
      vs.status, vs.provider, vs.provider_room_name, vs.authorized_start_at, vs.authorized_end_at, vs.actual_started_at, vs.actual_ended_at, vs.recording_policy, vs.recording_status, vs.version
    FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id INNER JOIN users u ON u.id = a.visitor_user_id
    WHERE vs.appointment_id = ? AND u.external_id = ?`).bind(visitId, identity.externalId).first<SessionRecord>();
  if (!record) throw new SecurityError("VISIT_NOT_FOUND", 404);
  assertJoinable(record);
  return record;
}

export async function getStaffSession(sessionId: string, facilityId: string): Promise<SessionRecord> {
  const d1 = await getD1();
  const record = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.facility_id, a.visitor_user_id, u.display_name AS visitor_name, a.prisoner_id, a.status AS appointment_status,
      vs.status, vs.provider, vs.provider_room_name, vs.authorized_start_at, vs.authorized_end_at, vs.actual_started_at, vs.actual_ended_at, vs.recording_policy, vs.recording_status, vs.version
    FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id INNER JOIN users u ON u.id = a.visitor_user_id
    WHERE vs.id = ? AND vs.facility_id = ?`).bind(sessionId, facilityId).first<SessionRecord>();
  if (!record) throw new SecurityError("SESSION_NOT_FOUND", 404);
  return record;
}

export function assertJoinable(record: SessionRecord): void {
  if (!["CONNECTING", "ACTIVE", "RECONNECTING"].includes(record.status)) {
    if (["ENDED", "TERMINATED", "CANCELLED"].includes(record.status)) throw new SecurityError("SESSION_ENDED", 409);
    throw new SecurityError("SESSION_NOT_READY", 409);
  }
  const end = Date.parse(record.authorized_end_at);
  if (Number.isFinite(end) && Date.now() > end + 60_000) throw new SecurityError("SESSION_EXPIRED", 409);
}

export function toSessionPayload(record: SessionRecord) {
  return {
    id: record.id,
    visitId: record.appointment_id,
    status: record.status,
    provider: record.provider,
    authorizedStartAt: record.authorized_start_at,
    authorizedEndAt: record.authorized_end_at,
    actualStartedAt: record.actual_started_at,
    actualEndedAt: record.actual_ended_at,
    recordingPolicy: record.recording_policy,
    recordingStatus: record.recording_status,
    visitor: record.visitor_name,
    prisonerId: record.prisoner_id,
  };
}
