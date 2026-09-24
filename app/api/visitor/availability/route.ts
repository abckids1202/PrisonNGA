import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { facilityLocalDateTime } from "../../../../lib/server/time";
import { validateVisitWindow } from "../../../../lib/server/visit-policy";

const slotMinutes = 15;

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const search = new URL(request.url).searchParams;
    const facilityId = search.get("facilityId")?.trim() || "";
    const prisonerId = search.get("prisonerId")?.trim() || "";
    const date = search.get("date")?.trim() || "";
    const excludeAppointmentId = search.get("excludeAppointmentId")?.trim() || "";
    const duration = Number(search.get("duration") || "15");
    if (!facilityId || !prisonerId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(duration)) throw new SecurityError("INVALID_AVAILABILITY_REQUEST", 400);
    const d1 = await getD1();
    const facility = await d1.prepare("SELECT id, timezone, current_state FROM facilities WHERE id = ?").bind(facilityId).first<{ id: string; timezone: string; current_state: string }>();
    const policy = await d1.prepare("SELECT min_duration_minutes, max_duration_minutes, min_advance_minutes, max_advance_days, daily_start_time, daily_end_time FROM visit_policies WHERE facility_id = ?").bind(facilityId).first<{ min_duration_minutes: number; max_duration_minutes: number; min_advance_minutes: number; max_advance_days: number; daily_start_time: string; daily_end_time: string }>();
    if (!facility || !policy) throw new SecurityError("FACILITY_POLICY_NOT_CONFIGURED", 503);
    if (facility.current_state !== "NORMAL_OPERATIONS") return securityResponse({ facilityId, date, duration, slots: [], reason: "FACILITY_NOT_ACCEPTING_REQUESTS" }, 200, context.requestId);
    if (duration < policy.min_duration_minutes || duration > policy.max_duration_minutes || duration % slotMinutes !== 0) throw new SecurityError("DURATION_NOT_ALLOWED", 400);
    const relationship = await d1.prepare("SELECT id FROM visitor_relationships WHERE visitor_user_id = ? AND facility_id = ? AND prisoner_id = ? AND status = 'APPROVED'").bind(visitor.userId, facilityId, prisonerId).first();
    if (!relationship) throw new SecurityError("RELATIONSHIP_NOT_APPROVED", 409);
    if (excludeAppointmentId) {
      const reschedulable = await d1.prepare("SELECT id FROM appointments WHERE id = ? AND facility_id = ? AND prisoner_id = ? AND visitor_user_id = ? AND status IN ('SUBMITTED', 'UNDER_REVIEW')")
        .bind(excludeAppointmentId, facilityId, prisonerId, visitor.userId)
        .first();
      if (!reschedulable) throw new SecurityError("APPOINTMENT_NOT_RESCHEDULABLE", 409);
    }
    let dayStart: Date;
    let dayEnd: Date;
    try {
      dayStart = facilityLocalDateTime(date, policy.daily_start_time, facility.timezone);
      dayEnd = facilityLocalDateTime(date, policy.daily_end_time, facility.timezone);
    } catch {
      throw new SecurityError("INVALID_AVAILABILITY_DATE", 400);
    }
    if (!Number.isFinite(dayStart.getTime()) || !Number.isFinite(dayEnd.getTime()) || dayEnd <= dayStart) throw new SecurityError("INVALID_AVAILABILITY_DATE", 400);
    const appointments = await d1.prepare(`SELECT requested_start, requested_end FROM appointments WHERE ((facility_id = ? AND prisoner_id = ?) OR visitor_user_id = ?) AND (? = '' OR id <> ?) AND status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'WAITING', 'IN_PROGRESS') AND requested_start < ? AND requested_end > ?`).bind(facilityId, prisonerId, visitor.userId, excludeAppointmentId, excludeAppointmentId, dayEnd.toISOString(), dayStart.toISOString()).all<{ requested_start: string; requested_end: string }>();
    const slots: string[] = [];
    for (let cursor = dayStart.getTime(); cursor + duration * 60000 <= dayEnd.getTime(); cursor += slotMinutes * 60000) {
      const end = cursor + duration * 60000;
      const window = validateVisitWindow(new Date(cursor).toISOString(), new Date(end).toISOString(), Date.now(), {
        timezone: facility.timezone,
        min_duration_minutes: policy.min_duration_minutes,
        max_duration_minutes: policy.max_duration_minutes,
        min_advance_minutes: policy.min_advance_minutes,
        max_advance_days: policy.max_advance_days,
        daily_start_time: policy.daily_start_time,
        daily_end_time: policy.daily_end_time,
      });
      if (!window.ok) continue;
      if (appointments.results.some((appointment) => Date.parse(appointment.requested_start) < end && Date.parse(appointment.requested_end) > cursor)) continue;
      slots.push(new Date(cursor).toISOString());
    }
    return securityResponse({ facilityId, prisonerId, date, duration, timezone: facility.timezone, slots }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
