import { getD1 } from "../../../../db/runtime";
import { appendAuditAndOutbox } from "../../../../lib/server/events";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

const activeStatuses = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "WAITING", "IN_PROGRESS"];

export async function GET() {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const d1 = await getD1();
    const result = await d1.prepare(`SELECT a.id, a.facility_id, a.prisoner_id, p.prisoner_number, p.display_name AS prisoner_name, a.status, a.requested_start, a.requested_end, a.timezone, a.appointment_type, a.version, a.created_at, a.updated_at
      FROM appointments a INNER JOIN prisoners p ON p.id = a.prisoner_id WHERE a.visitor_user_id = ? ORDER BY a.requested_start DESC`).bind(visitor.userId).all();
    return securityResponse({ appointments: result.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const body = await request.json() as { relationshipId?: unknown; requestedStart?: unknown; requestedEnd?: unknown; appointmentType?: unknown };
    const relationshipId = typeof body.relationshipId === "string" ? body.relationshipId.trim() : "";
    const requestedStart = typeof body.requestedStart === "string" ? body.requestedStart : "";
    const requestedEnd = typeof body.requestedEnd === "string" ? body.requestedEnd : "";
    const appointmentType = typeof body.appointmentType === "string" ? body.appointmentType.trim().slice(0, 40) : "FAMILY";
    const startMs = Date.parse(requestedStart);
    const endMs = Date.parse(requestedEnd);
    if (!relationshipId || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs < 15 * 60_000 || endMs - startMs > 30 * 60_000) throw new SecurityError("INVALID_APPOINTMENT_WINDOW", 400);
    if (startMs < Date.now() - 60_000) throw new SecurityError("APPOINTMENT_MUST_BE_FUTURE", 400);
    const d1 = await getD1();
    const relationship = await d1.prepare(`SELECT vr.id, vr.facility_id, vr.prisoner_id, vr.status, p.status AS prisoner_status, p.visitation_status FROM visitor_relationships vr INNER JOIN prisoners p ON p.id = vr.prisoner_id WHERE vr.id = ? AND vr.visitor_user_id = ?`).bind(relationshipId, visitor.userId).first<{ id: string; facility_id: string; prisoner_id: string; status: string; prisoner_status: string; visitation_status: string }>();
    if (!relationship || relationship.status !== "APPROVED" || relationship.prisoner_status !== "ACTIVE" || relationship.visitation_status !== "APPROVED") throw new SecurityError("RELATIONSHIP_NOT_APPROVED", 409);
    const policy = await d1.prepare("SELECT f.timezone, f.current_state, vp.min_duration_minutes, vp.max_duration_minutes, vp.min_advance_minutes, vp.max_advance_days, vp.daily_start_time, vp.daily_end_time FROM facilities f LEFT JOIN visit_policies vp ON vp.facility_id = f.id WHERE f.id = ?").bind(relationship.facility_id).first<{ timezone: string; current_state: string; min_duration_minutes: number | null; max_duration_minutes: number | null; min_advance_minutes: number | null; max_advance_days: number | null; daily_start_time: string | null; daily_end_time: string | null }>();
    if (!policy || policy.min_duration_minutes == null || policy.max_duration_minutes == null || policy.min_advance_minutes == null || policy.max_advance_days == null || !policy.daily_start_time || !policy.daily_end_time) throw new SecurityError("FACILITY_POLICY_NOT_CONFIGURED", 503);
    const durationMinutes = (endMs - startMs) / 60000;
    if (policy.current_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    if (durationMinutes < policy.min_duration_minutes || durationMinutes > policy.max_duration_minutes || durationMinutes % 15 !== 0) throw new SecurityError("DURATION_NOT_ALLOWED", 400);
    if (startMs < Date.now() + policy.min_advance_minutes * 60000 || startMs > Date.now() + policy.max_advance_days * 86400000) throw new SecurityError("APPOINTMENT_OUTSIDE_BOOKING_HORIZON", 400);
    const localParts = new Intl.DateTimeFormat("en-GB", { timeZone: policy.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startMs));
    const localTime = `${localParts.find((part) => part.type === "hour")?.value || "00"}:${localParts.find((part) => part.type === "minute")?.value || "00"}`;
    if (localTime < policy.daily_start_time || localTime > policy.daily_end_time || new Date(endMs).toLocaleDateString("en-CA", { timeZone: policy.timezone }) !== new Date(startMs).toLocaleDateString("en-CA", { timeZone: policy.timezone })) throw new SecurityError("APPOINTMENT_OUTSIDE_OPERATING_HOURS", 400);
    const overlap = await d1.prepare(`SELECT id FROM appointments WHERE visitor_user_id = ? AND status IN (${activeStatuses.map(() => "?").join(",")}) AND requested_start < ? AND requested_end > ? LIMIT 1`).bind(visitor.userId, ...activeStatuses, requestedEnd, requestedStart).first<{ id: string }>();
    if (overlap) throw new SecurityError("APPOINTMENT_OVERLAP", 409);
    const prisonerOverlap = await d1.prepare(`SELECT id FROM appointments WHERE facility_id = ? AND prisoner_id = ? AND status IN (${activeStatuses.map(() => "?").join(",")}) AND requested_start < ? AND requested_end > ? LIMIT 1`).bind(relationship.facility_id, relationship.prisoner_id, ...activeStatuses, requestedEnd, requestedStart).first<{ id: string }>();
    if (prisonerOverlap) throw new SecurityError("PRISONER_APPOINTMENT_OVERLAP", 409);
    const appointmentId = `SV-${new Date(startMs).toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await d1.batch([
      d1.prepare(`INSERT INTO appointments (id, facility_id, visitor_user_id, prisoner_id, status, requested_start, requested_end, timezone, appointment_type, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?, 'Asia/Jakarta', ?, 1, ?, ?)`)
        .bind(appointmentId, relationship.facility_id, visitor.userId, relationship.prisoner_id, requestedStart, requestedEnd, appointmentType, now, now),
      d1.prepare(`INSERT INTO appointment_status_events (id, appointment_id, from_status, to_status, actor_user_id, reason_code, reason_text, correlation_id, created_at) VALUES (?, ?, NULL, 'SUBMITTED', ?, 'VISITOR_SUBMITTED', 'Visitor submitted an appointment request.', ?, ?)`)
        .bind(crypto.randomUUID(), appointmentId, visitor.userId, correlationId, now),
    ]);
    await appendAuditAndOutbox({ actorUserId: visitor.userId, actorRole: "VISITOR", facilityId: relationship.facility_id, actionType: "APPOINTMENT_SUBMITTED", entityType: "appointment", entityId: appointmentId, reason: "Visitor submitted an appointment request.", newValues: { status: "SUBMITTED", requestedStart, requestedEnd, prisonerId: relationship.prisoner_id }, requestId: context.requestId, correlationId, eventType: "APPOINTMENT_SUBMITTED", payload: { appointmentId, visitorUserId: visitor.userId } });
    return securityResponse({ appointmentId, status: "SUBMITTED", correlationId }, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
