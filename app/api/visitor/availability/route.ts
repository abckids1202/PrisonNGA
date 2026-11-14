import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { facilityLocalDateTime } from "../../../../lib/server/time";
import { operatingHoursForWeekday, validateVisitWindow } from "../../../../lib/server/visit-policy";

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
    const facility = await d1.prepare("SELECT f.id, f.timezone, f.current_state FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?").bind(facilityId).first<{ id: string; timezone: string; current_state: string }>();
    const policy = await d1.prepare("SELECT vp.min_duration_minutes, vp.max_duration_minutes, vp.min_advance_minutes, vp.max_advance_days, vp.daily_start_time, vp.daily_end_time, vp.weekly_hours_json FROM visit_policies vp INNER JOIN facilities f ON f.id = vp.facility_id INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE vp.facility_id = ?").bind(facilityId).first<{ min_duration_minutes: number; max_duration_minutes: number; min_advance_minutes: number; max_advance_days: number; daily_start_time: string; daily_end_time: string; weekly_hours_json: string | null }>();
    if (!facility || !policy) throw new SecurityError("FACILITY_POLICY_NOT_CONFIGURED", 503);
    if (facility.current_state !== "NORMAL_OPERATIONS") return securityResponse({ facilityId, date, duration, slots: [], reason: "FACILITY_NOT_ACCEPTING_REQUESTS" }, 200, context.requestId);
    if (duration < policy.min_duration_minutes || duration > policy.max_duration_minutes || duration % slotMinutes !== 0) throw new SecurityError("DURATION_NOT_ALLOWED", 400);
    const relationship = await d1.prepare("SELECT vr.id FROM visitor_relationships vr INNER JOIN facilities f ON f.id = vr.facility_id INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE vr.visitor_user_id = ? AND vr.facility_id = ? AND vr.prisoner_id = ? AND vr.status = 'APPROVED'").bind(visitor.userId, facilityId, prisonerId).first();
    if (!relationship) throw new SecurityError("RELATIONSHIP_NOT_APPROVED", 409);
    if (excludeAppointmentId) {
      const reschedulable = await d1.prepare("SELECT a.id FROM appointments a INNER JOIN facilities f ON f.id = a.facility_id INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE a.id = ? AND a.facility_id = ? AND a.prisoner_id = ? AND a.visitor_user_id = ? AND a.status IN ('SUBMITTED', 'UNDER_REVIEW')")
        .bind(excludeAppointmentId, facilityId, prisonerId, visitor.userId)
        .first();
      if (!reschedulable) throw new SecurityError("APPOINTMENT_NOT_RESCHEDULABLE", 409);
    }
    let dayStart: Date;
    let dayEnd: Date;
    try {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const hours = operatingHoursForWeekday({ ...policy, timezone: facility.timezone }, weekday);
      if (!hours?.open || !hours.close) return securityResponse({ facilityId, prisonerId, date, duration, timezone: facility.timezone, slots: [] }, 200, context.requestId);
      dayStart = facilityLocalDateTime(date, hours.open, facility.timezone);
      dayEnd = facilityLocalDateTime(date, hours.close, facility.timezone);
    } catch {
      throw new SecurityError("INVALID_AVAILABILITY_DATE", 400);
    }
    if (!Number.isFinite(dayStart.getTime()) || !Number.isFinite(dayEnd.getTime()) || dayEnd <= dayStart) throw new SecurityError("INVALID_AVAILABILITY_DATE", 400);
    const appointments = await d1.prepare(`SELECT a.requested_start, a.requested_end FROM appointments a INNER JOIN facilities f ON f.id = a.facility_id INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE ((a.facility_id = ? AND a.prisoner_id = ?) OR a.visitor_user_id = ?) AND (? = '' OR a.id <> ?) AND a.status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'WAITING', 'IN_PROGRESS') AND a.requested_start < ? AND a.requested_end > ?`).bind(facilityId, prisonerId, visitor.userId, excludeAppointmentId, excludeAppointmentId, dayEnd.toISOString(), dayStart.toISOString()).all<{ requested_start: string; requested_end: string }>();
    const closures = await d1.prepare(`SELECT fc.starts_at, fc.ends_at FROM facility_closures fc
      INNER JOIN facilities f ON f.id = fc.facility_id INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
      WHERE fc.facility_id = ? AND fc.status = 'ACTIVE' AND fc.starts_at < ? AND fc.ends_at > ?`)
      .bind(facilityId, dayEnd.toISOString(), dayStart.toISOString())
      .all<{ starts_at: string; ends_at: string }>();
    const resources = await d1.prepare(`SELECT r.id, r.resource_type, r.status, r.health_state FROM resources r
      INNER JOIN facilities f ON f.id = r.facility_id INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
      WHERE r.facility_id = ? AND r.health_state = 'HEALTHY' AND r.status IN ('AVAILABLE', 'ONLINE')
        AND (r.resource_type = 'ROOM' OR (r.last_heartbeat_at IS NOT NULL AND julianday(r.last_heartbeat_at) >= julianday('now', '-3 minutes')))`)
      .bind(facilityId)
      .all<{ id: string; resource_type: "ROOM" | "DEVICE"; status: string; health_state: string }>();
    const reservations = await d1.prepare(`SELECT rr.resource_id, rr.starts_at, rr.ends_at FROM resource_reservations rr
      INNER JOIN facilities f ON f.id = rr.facility_id INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
      WHERE rr.facility_id = ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?`)
      .bind(facilityId, dayEnd.toISOString(), dayStart.toISOString())
      .all<{ resource_id: string; starts_at: string; ends_at: string }>();
    const hasCapacity = (start: number, end: number) => ["ROOM", "DEVICE"].every((type) => resources.results.some((resource) => resource.resource_type === type && !reservations.results.some((reservation) => reservation.resource_id === resource.id && Date.parse(reservation.starts_at) < end && Date.parse(reservation.ends_at) > start)));
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
        weekly_hours_json: policy.weekly_hours_json,
      });
      if (!window.ok) continue;
      if (appointments.results.some((appointment) => Date.parse(appointment.requested_start) < end && Date.parse(appointment.requested_end) > cursor)) continue;
      if (closures.results.some((closure) => Date.parse(closure.starts_at) < end && Date.parse(closure.ends_at) > cursor)) continue;
      if (!hasCapacity(cursor, end)) continue;
      slots.push(new Date(cursor).toISOString());
    }
    return securityResponse({ facilityId, prisonerId, date, duration, timezone: facility.timezone, slots }, 200, context.requestId);
  } catch (error) { return securityErrorResponse(error, context.requestId); }
}
