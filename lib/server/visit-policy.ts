export type VisitWindowPolicy = {
  timezone: string | null;
  min_duration_minutes: number | null;
  max_duration_minutes: number | null;
  min_advance_minutes: number | null;
  max_advance_days: number | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
};

export type VisitWindowFailure =
  | "INVALID_APPOINTMENT_WINDOW"
  | "FACILITY_POLICY_NOT_CONFIGURED"
  | "FACILITY_TIMEZONE_INVALID"
  | "DURATION_NOT_ALLOWED"
  | "APPOINTMENT_OUTSIDE_BOOKING_HORIZON"
  | "APPOINTMENT_OUTSIDE_OPERATING_HOURS";

export type VisitWindowResult =
  | {
      ok: true;
      requestedStart: string;
      requestedEnd: string;
      earliestStartAt: string;
      latestStartAt: string;
    }
  | { ok: false; reason: VisitWindowFailure };

type LocalDateTime = { date: string; minutes: number };

function parseClock(value: string | null): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function inTimeZone(timestamp: number, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function validateVisitWindow(
  requestedStart: string,
  requestedEnd: string,
  nowMs: number,
  policy: VisitWindowPolicy,
): VisitWindowResult {
  const startMs = Date.parse(requestedStart);
  const endMs = Date.parse(requestedEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { ok: false, reason: "INVALID_APPOINTMENT_WINDOW" };
  }

  const minDuration = policy.min_duration_minutes;
  const maxDuration = policy.max_duration_minutes;
  const minAdvance = policy.min_advance_minutes;
  const maxAdvanceDays = policy.max_advance_days;
  const open = parseClock(policy.daily_start_time);
  const close = parseClock(policy.daily_end_time);
  if (
    !policy.timezone ||
    !Number.isFinite(minDuration) || minDuration! <= 0 ||
    !Number.isFinite(maxDuration) || maxDuration! < minDuration! ||
    !Number.isFinite(minAdvance) || minAdvance! < 0 ||
    !Number.isFinite(maxAdvanceDays) || maxAdvanceDays! <= 0 ||
    open === null || close === null || open >= close
  ) {
    return { ok: false, reason: "FACILITY_POLICY_NOT_CONFIGURED" };
  }

  const durationMinutes = (endMs - startMs) / 60_000;
  if (durationMinutes < minDuration! || durationMinutes > maxDuration! || durationMinutes % 15 !== 0) {
    return { ok: false, reason: "DURATION_NOT_ALLOWED" };
  }

  const earliestStartMs = nowMs + minAdvance! * 60_000;
  const latestStartMs = nowMs + maxAdvanceDays! * 86_400_000;
  if (startMs < earliestStartMs || startMs > latestStartMs) {
    return { ok: false, reason: "APPOINTMENT_OUTSIDE_BOOKING_HORIZON" };
  }

  let localStart: LocalDateTime;
  let localEnd: LocalDateTime;
  try {
    localStart = inTimeZone(startMs, policy.timezone);
    localEnd = inTimeZone(endMs, policy.timezone);
  } catch {
    return { ok: false, reason: "FACILITY_TIMEZONE_INVALID" };
  }
  if (localStart.date !== localEnd.date || localStart.minutes < open || localEnd.minutes > close) {
    return { ok: false, reason: "APPOINTMENT_OUTSIDE_OPERATING_HOURS" };
  }

  return {
    ok: true,
    requestedStart: new Date(startMs).toISOString(),
    requestedEnd: new Date(endMs).toISOString(),
    earliestStartAt: new Date(earliestStartMs).toISOString(),
    latestStartAt: new Date(latestStartMs).toISOString(),
  };
}
