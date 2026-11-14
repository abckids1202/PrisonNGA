import { getD1 } from "../../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../../../lib/server/idempotency";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";

type RouteContext = { params: Promise<{ visitId: string }> };
type ConsentDecision = "GRANTED" | "DECLINED";

function asDecision(value: unknown): ConsentDecision {
  if (value === "GRANTED" || value === "DECLINED") return value;
  throw new SecurityError("RECORDING_CONSENT_DECISION_REQUIRED", 400);
}

function asNoticeVersion(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(value.trim())) throw new SecurityError("RECORDING_NOTICE_VERSION_REQUIRED", 400);
  return value.trim();
}

export async function GET(_request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const { visitId } = await context.params;
    const d1 = await getD1();
    const session = await d1.prepare(`SELECT vs.id AS session_id, vs.facility_id, vs.status AS session_status, vs.recording_policy, vs.recording_status,
        vp.version AS policy_version, vp.recording_policy AS facility_recording_policy,
        rc.decision, rc.notice_version, rc.decided_at
      FROM visit_sessions vs
      INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
      INNER JOIN facilities f ON f.id = vs.facility_id
      INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
      LEFT JOIN visit_policies vp ON vp.facility_id = vs.facility_id
      LEFT JOIN recording_consents rc ON rc.session_id = vs.id AND rc.participant_user_id = a.visitor_user_id
      WHERE vs.appointment_id = ? AND a.visitor_user_id = ?`).bind(visitId, visitor.userId).first<Record<string, string | number | null>>();
    if (!session) throw new SecurityError("VISIT_NOT_FOUND", 404);
    return securityResponse({
      sessionId: session.session_id,
      policy: session.facility_recording_policy || session.recording_policy,
      status: session.recording_status,
      policyVersion: session.policy_version,
      consent: session.decision ? { decision: session.decision, noticeVersion: session.notice_version, decidedAt: session.decided_at } : null,
    }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const visitor = await requireVisitorIdentity();
    const { visitId } = await context.params;
    const body = await request.json() as { decision?: unknown; noticeVersion?: unknown };
    const decision = asDecision(body.decision);
    const noticeVersion = asNoticeVersion(body.noticeVersion);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);

    d1 = await getD1();
    const current = await d1.prepare(`SELECT vs.id AS session_id, vs.facility_id, vs.status AS session_status, vs.recording_policy, vs.recording_status,
        vp.version AS policy_version, vp.recording_policy AS facility_recording_policy,
        a.visitor_user_id
      FROM visit_sessions vs
      INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
      INNER JOIN facilities f ON f.id = vs.facility_id
      INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
      LEFT JOIN visit_policies vp ON vp.facility_id = vs.facility_id
      WHERE vs.appointment_id = ? AND a.visitor_user_id = ?`).bind(visitId, visitor.userId).first<{ session_id: string; facility_id: string; session_status: string; recording_policy: string; recording_status: string; policy_version: number | null; facility_recording_policy: string | null; visitor_user_id: string }>();
    if (!current) throw new SecurityError("VISIT_NOT_FOUND", 404);
    const policy = current.facility_recording_policy || current.recording_policy;
    if (policy !== "ON") throw new SecurityError("RECORDING_NOT_ALLOWED", 409);
    if (!Number.isInteger(current.policy_version) || (current.policy_version as number) < 1) throw new SecurityError("RECORDING_POLICY_VERSION_UNAVAILABLE", 503);
    if (!["PREPARING", "CONNECTING", "ACTIVE", "RECONNECTING"].includes(current.session_status)) throw new SecurityError("RECORDING_CONSENT_CLOSED", 409);

    const existing = await d1.prepare(`SELECT id, decision, notice_version, decided_at, correlation_id
      FROM recording_consents WHERE session_id = ? AND participant_user_id = ? AND facility_id = ?`)
      .bind(current.session_id, visitor.userId, current.facility_id).first<Record<string, string>>();
    if (existing) {
      if (existing.decision !== decision || existing.notice_version !== noticeVersion) throw new SecurityError("RECORDING_CONSENT_ALREADY_RECORDED", 409);
      return securityResponse({ consent: { ...existing }, idempotent: true }, 200, requestContext.requestId);
    }

    const scope = `recording-consent:${current.facility_id}:${current.session_id}:${visitor.userId}`;
    const requestHash = await hashIdempotencyPayload({ visitId, decision, noticeVersion });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, requestContext.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };

    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const consentId = crypto.randomUUID();
    const nextRecordingStatus = decision === "GRANTED" ? "CONSENTED" : "CONSENT_DECLINED";
    const responseBody = { consent: { id: consentId, sessionId: current.session_id, decision, noticeVersion, decidedAt: now, correlationId }, idempotent: false };
    const event = {
      actorUserId: visitor.userId,
      actorRole: "VISITOR",
      facilityId: current.facility_id,
      actionType: "RECORDING_CONSENT_RECORDED",
      entityType: "visit_session",
      entityId: current.session_id,
      reason: decision === "GRANTED" ? "Visitor granted recording consent." : "Visitor declined recording consent.",
      oldValues: { recordingStatus: current.recording_status },
      newValues: { decision, recordingStatus: nextRecordingStatus, noticeVersion },
      requestId: requestContext.requestId,
      correlationId,
      eventType: "RECORDING_CONSENT_RECORDED",
      payload: { sessionId: current.session_id, appointmentId: visitId, decision, noticeVersion },
    };
    const result = await d1.batch([
      d1.prepare(`INSERT INTO recording_consents (id, session_id, facility_id, participant_user_id, participant_role, decision, policy_version, notice_version, decided_at, correlation_id, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'VISITOR', ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?)`)
        .bind(consentId, current.session_id, current.facility_id, visitor.userId, decision, current.policy_version, noticeVersion, now, correlationId, now, now, current.facility_id),
      d1.prepare(`UPDATE visit_sessions SET recording_status = ?, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND recording_status = ?
        AND EXISTS (SELECT 1 FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?)`)
        .bind(nextRecordingStatus, now, current.session_id, current.facility_id, current.recording_status, current.facility_id),
      ...auditAndOutboxStatements(d1, event, { sql: "EXISTS (SELECT 1 FROM recording_consents WHERE id = ? AND facility_id = ?) AND EXISTS (SELECT 1 FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?)", values: [consentId, current.facility_id, current.facility_id] }),
      completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard: { sql: "EXISTS (SELECT 1 FROM recording_consents WHERE id = ? AND facility_id = ?) AND EXISTS (SELECT 1 FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?)", values: [consentId, current.facility_id, current.facility_id] } }),
    ]);
    if (!result.every((entry) => Boolean(entry?.meta.changes))) throw new SecurityError("RECORDING_CONSENT_PERSISTENCE_INCOMPLETE", 503);
    idempotency = null;
    return securityResponse(responseBody, 201, requestContext.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original error. */ }
    }
    return securityErrorResponse(error, requestContext.requestId);
  }
}
