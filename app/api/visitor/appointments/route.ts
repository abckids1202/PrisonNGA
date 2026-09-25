import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { claimIdempotency, hashIdempotencyPayload, releaseIdempotencyClaim } from "../../../../lib/server/idempotency";
import { validateVisitWindow } from "../../../../lib/server/visit-policy";
import { cancelVisitorAppointmentStatements, createVisitorAppointmentStatements, rescheduleVisitorAppointmentStatements } from "../../../../lib/server/visitor-appointments";
import { enforceRateLimit } from "../../../../lib/server/rate-limit";

const activeStatuses = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "WAITING", "IN_PROGRESS"];

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT a.id, a.facility_id, f.name AS facility_name, a.prisoner_id, p.prisoner_number, p.display_name AS prisoner_name, a.status, a.requested_start, a.requested_end, a.timezone, a.appointment_type, a.version, a.created_at, a.updated_at
      FROM appointments a INNER JOIN facilities f ON f.id = a.facility_id INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id WHERE a.visitor_user_id = ? ORDER BY a.requested_start DESC`).bind(visitor.userId).all();
    return securityResponse({ appointments: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let activeClaim: { d1: D1Database; scope: string; key: string; claimId: string } | null = null;
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { relationshipId?: unknown; requestedStart?: unknown; requestedEnd?: unknown; appointmentType?: unknown };
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    const relationshipId = typeof body.relationshipId === "string" ? body.relationshipId.trim() : "";
    const requestedStart = typeof body.requestedStart === "string" ? body.requestedStart : "";
    const requestedEnd = typeof body.requestedEnd === "string" ? body.requestedEnd : "";
    const appointmentType = typeof body.appointmentType === "string" ? body.appointmentType.trim().slice(0, 40) : "FAMILY";
    const startMs = Date.parse(requestedStart);
    const endMs = Date.parse(requestedEnd);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    if (!relationshipId || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new SecurityError("INVALID_APPOINTMENT_WINDOW", 400);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `visitor-appointment-create:${visitor.userId}`, limit: 20, windowSeconds: 60 * 60 });
    const idempotencyScope = `visitor:${visitor.userId}:appointment:create`;
    const requestHash = await hashIdempotencyPayload({ relationshipId, requestedStart, requestedEnd, appointmentType });
    const claim = await claimIdempotency(d1, { scope: idempotencyScope, key: idempotencyKey, requestHash });
    if ("replay" in claim) return securityResponse(claim.replay.body, claim.replay.status, context.requestId);
    activeClaim = { d1, scope: idempotencyScope, key: idempotencyKey, claimId: claim.claimId };
    if (startMs < Date.now() - 60_000) throw new SecurityError("APPOINTMENT_MUST_BE_FUTURE", 400);
    const relationship = await d1.prepare(`SELECT vr.id, vr.facility_id, vr.prisoner_id, vr.status, p.status AS prisoner_status, p.visitation_status FROM visitor_relationships vr INNER JOIN prisoners p ON p.id = vr.prisoner_id AND p.facility_id = vr.facility_id WHERE vr.id = ? AND vr.visitor_user_id = ?`).bind(relationshipId, visitor.userId).first<{ id: string; facility_id: string; prisoner_id: string; status: string; prisoner_status: string; visitation_status: string }>();
    if (!relationship || relationship.status !== "APPROVED" || relationship.prisoner_status !== "ACTIVE" || relationship.visitation_status !== "APPROVED") throw new SecurityError("RELATIONSHIP_NOT_APPROVED", 409);
    const appointmentTypeRecord = await d1.prepare("SELECT code, duration_minutes, credit_cost FROM appointment_types WHERE facility_id = ? AND code = ? AND status = 'ACTIVE'").bind(relationship.facility_id, appointmentType).first<{ code: string; duration_minutes: number; credit_cost: number }>();
    if (!appointmentTypeRecord) throw new SecurityError("APPOINTMENT_TYPE_NOT_AVAILABLE", 409);
    if (appointmentTypeRecord.credit_cost !== 1) throw new SecurityError("APPOINTMENT_TYPE_CREDIT_RULE_UNSUPPORTED", 503);
    const creditAccount = await d1.prepare("SELECT available_credits FROM credit_accounts WHERE user_id = ? AND facility_id = ?").bind(visitor.userId, relationship.facility_id).first<{ available_credits: number }>();
    if (!creditAccount || creditAccount.available_credits < 1) throw new SecurityError("VISIT_CREDIT_REQUIRED", 409);
    const policy = await d1.prepare("SELECT f.timezone, f.current_state, vp.version AS policy_version, vp.min_duration_minutes, vp.max_duration_minutes, vp.min_advance_minutes, vp.max_advance_days, vp.daily_start_time, vp.daily_end_time FROM facilities f LEFT JOIN visit_policies vp ON vp.facility_id = f.id WHERE f.id = ?").bind(relationship.facility_id).first<{ timezone: string | null; current_state: string; policy_version: number | null; min_duration_minutes: number | null; max_duration_minutes: number | null; min_advance_minutes: number | null; max_advance_days: number | null; daily_start_time: string | null; daily_end_time: string | null }>();
    if (!policy) throw new SecurityError("FACILITY_POLICY_NOT_CONFIGURED", 503);
    if (policy.current_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    if (policy.policy_version === null || !policy.timezone) throw new SecurityError("FACILITY_POLICY_NOT_CONFIGURED", 503);
    const window = validateVisitWindow(requestedStart, requestedEnd, Date.now(), policy);
    if (!window.ok) throw new SecurityError(window.reason, window.reason.startsWith("FACILITY_") ? 503 : 400);
    const canonicalStart = window.requestedStart;
    const canonicalEnd = window.requestedEnd;
    const appointmentId = `SV-${new Date(startMs).toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const responseBody = { appointmentId, status: "SUBMITTED" as const, correlationId };
    const created = await d1.batch(createVisitorAppointmentStatements(d1, {
      appointmentId,
      facilityId: relationship.facility_id,
      visitorUserId: visitor.userId,
      prisonerId: relationship.prisoner_id,
      relationshipId,
      requestedStart: canonicalStart,
      requestedEnd: canonicalEnd,
      timezone: policy.timezone,
      policyVersion: policy.policy_version,
      durationMinutes: Math.round((endMs - startMs) / 60_000),
      appointmentType,
      now,
      correlationId,
      requestId: context.requestId,
      idempotency: activeClaim!,
      responseBody,
    }));
    if (!created[0]?.meta.changes) {
      const visitorOverlap = await d1.prepare(`SELECT id FROM appointments WHERE visitor_user_id = ? AND status IN (${activeStatuses.map(() => "?").join(",")}) AND requested_start < ? AND requested_end > ? LIMIT 1`).bind(visitor.userId, ...activeStatuses, canonicalEnd, canonicalStart).first();
      if (visitorOverlap) throw new SecurityError("APPOINTMENT_OVERLAP", 409);
      const prisonerOverlap = await d1.prepare(`SELECT id FROM appointments WHERE facility_id = ? AND prisoner_id = ? AND status IN (${activeStatuses.map(() => "?").join(",")}) AND requested_start < ? AND requested_end > ? LIMIT 1`).bind(relationship.facility_id, relationship.prisoner_id, ...activeStatuses, canonicalEnd, canonicalStart).first();
      if (prisonerOverlap) throw new SecurityError("PRISONER_APPOINTMENT_OVERLAP", 409);
      const currentRelationship = await d1.prepare(`SELECT vr.status, p.status AS prisoner_status, p.visitation_status FROM visitor_relationships vr INNER JOIN prisoners p ON p.id = vr.prisoner_id AND p.facility_id = vr.facility_id WHERE vr.id = ? AND vr.facility_id = ? AND vr.visitor_user_id = ?`).bind(relationshipId, relationship.facility_id, visitor.userId).first<{ status: string; prisoner_status: string; visitation_status: string }>();
      if (!currentRelationship || currentRelationship.status !== "APPROVED" || currentRelationship.prisoner_status !== "ACTIVE" || currentRelationship.visitation_status !== "APPROVED") throw new SecurityError("RELATIONSHIP_NOT_APPROVED", 409);
      const currentPolicy = await d1.prepare("SELECT f.current_state, f.timezone, vp.version AS policy_version FROM facilities f LEFT JOIN visit_policies vp ON vp.facility_id = f.id WHERE f.id = ?").bind(relationship.facility_id).first<{ current_state: string; timezone: string | null; policy_version: number | null }>();
      if (!currentPolicy || currentPolicy.current_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
      if (currentPolicy.timezone !== policy.timezone || currentPolicy.policy_version !== policy.policy_version) throw new SecurityError("FACILITY_POLICY_CHANGED", 409);
      const currentCredit = await d1.prepare("SELECT available_credits FROM credit_accounts WHERE user_id = ? AND facility_id = ?").bind(visitor.userId, relationship.facility_id).first<{ available_credits: number }>();
      if (!currentCredit || currentCredit.available_credits < 1) throw new SecurityError("VISIT_CREDIT_REQUIRED", 409);
      throw new SecurityError("APPOINTMENT_REQUEST_CONFLICT", 409);
    }
    activeClaim = null;
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    if (activeClaim) {
      try {
        await releaseIdempotencyClaim(activeClaim.d1, activeClaim);
      } catch {
        // The ten-minute stale-claim recovery is the fallback if cleanup is unavailable.
      }
    }
    return securityErrorResponse(error, context.requestId);
  }
}

export async function PATCH(request: Request) {
  const context = await getRequestContext();
  let activeClaim: { d1: D1Database; scope: string; key: string; claimId: string } | null = null;
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { appointmentId?: unknown; action?: unknown; requestedStart?: unknown; requestedEnd?: unknown; expectedVersion?: unknown };
    const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId.trim() : "";
    const action = body.action === "cancel" || body.action === "reschedule" ? body.action : "";
    if (!appointmentId || !action) throw new SecurityError("INVALID_APPOINTMENT_ACTION", 400);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `visitor-appointment-change:${visitor.userId}`, limit: 30, windowSeconds: 60 * 60 });
    const appointment = await d1.prepare(`SELECT a.id, a.facility_id, a.prisoner_id, a.status, a.version, a.requested_start, a.requested_end, f.current_state, vp.version AS policy_version, vp.min_duration_minutes, vp.max_duration_minutes, vp.min_advance_minutes, vp.max_advance_days, vp.daily_start_time, vp.daily_end_time, f.timezone, ca.id AS credit_account_id
      FROM appointments a INNER JOIN facilities f ON f.id = a.facility_id LEFT JOIN visit_policies vp ON vp.facility_id = a.facility_id LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
      WHERE a.id = ? AND a.visitor_user_id = ?`).bind(appointmentId, visitor.userId).first<Record<string, string | number | null>>();
    if (!appointment) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== Number(appointment.version)) throw new SecurityError("STALE_APPOINTMENT", 409);
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    if (action === "cancel") {
      if (!["SUBMITTED", "UNDER_REVIEW", "APPROVED", "WAITING"].includes(String(appointment.status))) throw new SecurityError("APPOINTMENT_NOT_CANCELLABLE", 409);
      const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
      const idempotencyScope = `visitor:${visitor.userId}:appointment:cancel:${appointmentId}`;
      const requestHash = await hashIdempotencyPayload({ appointmentId, action, expectedVersion: Number(appointment.version) });
      const claim = await claimIdempotency(d1, { scope: idempotencyScope, key: idempotencyKey, requestHash });
      if ("replay" in claim) return securityResponse(claim.replay.body, claim.replay.status, context.requestId);
      activeClaim = { d1, scope: idempotencyScope, key: idempotencyKey, claimId: claim.claimId };
      const responseBody = { appointmentId, status: "CANCELLED_BY_VISITOR" as const, version: Number(appointment.version) + 1, correlationId };
      const cancelled = await d1.batch(cancelVisitorAppointmentStatements(d1, {
        appointmentId,
        facilityId: String(appointment.facility_id),
        visitorUserId: visitor.userId,
        previousStatus: String(appointment.status),
        expectedVersion: Number(appointment.version),
        creditAccountId: appointment.credit_account_id ? String(appointment.credit_account_id) : null,
        now,
        correlationId,
        requestId: context.requestId,
        idempotency: activeClaim,
        responseBody,
      }));
      if (!cancelled[0]?.meta.changes) throw new SecurityError("STALE_APPOINTMENT", 409);
      activeClaim = null;
      return securityResponse(responseBody, 200, context.requestId);
    }
    if (!["SUBMITTED", "UNDER_REVIEW"].includes(String(appointment.status))) throw new SecurityError("APPOINTMENT_NOT_RESCHEDULABLE", 409);
    const requestedStart = typeof body.requestedStart === "string" ? body.requestedStart : "";
    const requestedEnd = typeof body.requestedEnd === "string" ? body.requestedEnd : "";
    if (appointment.current_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    const window = validateVisitWindow(requestedStart, requestedEnd, Date.now(), {
      timezone: typeof appointment.timezone === "string" ? appointment.timezone : null,
      min_duration_minutes: appointment.min_duration_minutes == null ? null : Number(appointment.min_duration_minutes),
      max_duration_minutes: appointment.max_duration_minutes == null ? null : Number(appointment.max_duration_minutes),
      min_advance_minutes: appointment.min_advance_minutes == null ? null : Number(appointment.min_advance_minutes),
      max_advance_days: appointment.max_advance_days == null ? null : Number(appointment.max_advance_days),
      daily_start_time: typeof appointment.daily_start_time === "string" ? appointment.daily_start_time : null,
      daily_end_time: typeof appointment.daily_end_time === "string" ? appointment.daily_end_time : null,
    });
    if (!window.ok) throw new SecurityError(window.reason, window.reason.startsWith("FACILITY_") ? 503 : 400);
    if (appointment.policy_version == null || typeof appointment.timezone !== "string") throw new SecurityError("FACILITY_POLICY_NOT_CONFIGURED", 503);
    const canonicalStart = window.requestedStart;
    const canonicalEnd = window.requestedEnd;
    if (Date.parse(canonicalStart) === Date.parse(String(appointment.requested_start)) && Date.parse(canonicalEnd) === Date.parse(String(appointment.requested_end))) throw new SecurityError("RESCHEDULE_TIME_UNCHANGED", 400);
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) !== Number(appointment.version)) throw new SecurityError("STALE_APPOINTMENT", 409);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const idempotencyScope = `visitor:${visitor.userId}:appointment:reschedule:${appointmentId}`;
    const requestHash = await hashIdempotencyPayload({ appointmentId, requestedStart: canonicalStart, requestedEnd: canonicalEnd, expectedVersion: Number(appointment.version) });
    const claim = await claimIdempotency(d1, { scope: idempotencyScope, key: idempotencyKey, requestHash });
    if ("replay" in claim) return securityResponse(claim.replay.body, claim.replay.status, context.requestId);
    activeClaim = { d1, scope: idempotencyScope, key: idempotencyKey, claimId: claim.claimId };
    const previousStatus = String(appointment.status) as "SUBMITTED" | "UNDER_REVIEW";
    const responseBody = {
      appointmentId,
      status: "UNDER_REVIEW" as const,
      requestedStart: canonicalStart,
      requestedEnd: canonicalEnd,
      version: Number(appointment.version) + 1,
      correlationId,
    };
    const rescheduled = await d1.batch(rescheduleVisitorAppointmentStatements(d1, {
      appointmentId,
      facilityId: String(appointment.facility_id),
      visitorUserId: visitor.userId,
      prisonerId: String(appointment.prisoner_id),
      expectedVersion: Number(appointment.version),
      previousStatus,
      requestedStart: canonicalStart,
      requestedEnd: canonicalEnd,
      timezone: appointment.timezone,
      policyVersion: Number(appointment.policy_version),
      durationMinutes: Math.round((Date.parse(canonicalEnd) - Date.parse(canonicalStart)) / 60_000),
      now,
      correlationId,
      requestId: context.requestId,
      idempotency: activeClaim,
      responseBody,
    }));
    if (!rescheduled[0]?.meta.changes) {
      const current = await d1.prepare("SELECT status, version FROM appointments WHERE id = ? AND facility_id = ? AND visitor_user_id = ?").bind(appointmentId, appointment.facility_id, visitor.userId).first<{ status: string; version: number }>();
      if (!current) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
      if (Number(current.version) !== Number(appointment.version)) throw new SecurityError("STALE_APPOINTMENT", 409);
      if (!["SUBMITTED", "UNDER_REVIEW"].includes(current.status)) throw new SecurityError("APPOINTMENT_NOT_RESCHEDULABLE", 409);
      const visitorOverlap = await d1.prepare(`SELECT id FROM appointments WHERE id <> ? AND visitor_user_id = ? AND status IN (${activeStatuses.map(() => "?").join(",")}) AND requested_start < ? AND requested_end > ? LIMIT 1`).bind(appointmentId, visitor.userId, ...activeStatuses, canonicalEnd, canonicalStart).first();
      if (visitorOverlap) throw new SecurityError("APPOINTMENT_OVERLAP", 409);
      const prisonerOverlap = await d1.prepare(`SELECT id FROM appointments WHERE id <> ? AND facility_id = ? AND prisoner_id = ? AND status IN (${activeStatuses.map(() => "?").join(",")}) AND requested_start < ? AND requested_end > ? LIMIT 1`).bind(appointmentId, appointment.facility_id, appointment.prisoner_id, ...activeStatuses, canonicalEnd, canonicalStart).first();
      if (prisonerOverlap) throw new SecurityError("PRISONER_APPOINTMENT_OVERLAP", 409);
      const relationship = await d1.prepare(`SELECT vr.status, p.status AS prisoner_status, p.visitation_status FROM visitor_relationships vr INNER JOIN prisoners p ON p.id = vr.prisoner_id AND p.facility_id = vr.facility_id WHERE vr.facility_id = ? AND vr.visitor_user_id = ? AND vr.prisoner_id = ?`).bind(appointment.facility_id, visitor.userId, appointment.prisoner_id).first<{ status: string; prisoner_status: string; visitation_status: string }>();
      if (!relationship || relationship.status !== "APPROVED" || relationship.prisoner_status !== "ACTIVE" || relationship.visitation_status !== "APPROVED") throw new SecurityError("RELATIONSHIP_NOT_APPROVED", 409);
      const currentPolicy = await d1.prepare("SELECT f.current_state, f.timezone, vp.version AS policy_version FROM facilities f LEFT JOIN visit_policies vp ON vp.facility_id = f.id WHERE f.id = ?").bind(appointment.facility_id).first<{ current_state: string; timezone: string | null; policy_version: number | null }>();
      if (!currentPolicy || currentPolicy.current_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
      if (currentPolicy.timezone !== appointment.timezone || currentPolicy.policy_version !== appointment.policy_version) throw new SecurityError("FACILITY_POLICY_CHANGED", 409);
      throw new SecurityError("APPOINTMENT_RESCHEDULE_CONFLICT", 409);
    }
    activeClaim = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (activeClaim) {
      try { await releaseIdempotencyClaim(activeClaim.d1, activeClaim); } catch { /* Stale claim recovery is the fallback if cleanup is unavailable. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
