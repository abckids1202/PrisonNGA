export type VisitWindowPolicy = {
  timezone: string | null;
  min_duration_minutes: number | null;
  max_duration_minutes: number | null;
  min_advance_minutes: number | null;
  max_advance_days: number | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
  weekly_hours_json?: string | null;
};

export type WeeklyHoursEntry = { open: string | null; close: string | null };

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

type LocalDateTime = { date: string; minutes: number; weekday: number };

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
    weekday: new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`).getUTCDay(),
  };
}

function parseWeeklyHours(value: string | null | undefined): WeeklyHoursEntry[] | null {
  if (value == null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 7) return null;
    const entries = parsed.map((entry): WeeklyHoursEntry | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const open = record.open === null ? null : typeof record.open === "string" ? record.open : undefined;
      const close = record.close === null ? null : typeof record.close === "string" ? record.close : undefined;
      if (open === undefined || close === undefined) return null;
      if (open === null && close === null) return { open: null, close: null };
      const openMinutes = parseClock(open);
      const closeMinutes = parseClock(close);
      return openMinutes !== null && closeMinutes !== null && openMinutes < closeMinutes ? { open, close } : null;
    });
    return entries.every((entry): entry is WeeklyHoursEntry => entry !== null) ? entries : null;
  } catch {
    return null;
  }
}

export function operatingHoursForWeekday(policy: VisitWindowPolicy, weekday: number): WeeklyHoursEntry | null {
  const weekly = parseWeeklyHours(policy.weekly_hours_json);
  if (policy.weekly_hours_json != null && !weekly) return null;
  if (weekly) return weekly[weekday] || null;
  return { open: policy.daily_start_time, close: policy.daily_end_time };
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
  const weekly = parseWeeklyHours(policy.weekly_hours_json);
  if (policy.weekly_hours_json != null && !weekly) return { ok: false, reason: "FACILITY_POLICY_NOT_CONFIGURED" };
  if (
    !policy.timezone ||
    !Number.isFinite(minDuration) || minDuration! <= 0 ||
    !Number.isFinite(maxDuration) || maxDuration! < minDuration! ||
    !Number.isFinite(minAdvance) || minAdvance! < 0 ||
    !Number.isFinite(maxAdvanceDays) || maxAdvanceDays! <= 0 ||
    policy.weekly_hours_json == null && (parseClock(policy.daily_start_time) === null || parseClock(policy.daily_end_time) === null || parseClock(policy.daily_start_time)! >= parseClock(policy.daily_end_time)!)
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
  const hours = operatingHoursForWeekday(policy, localStart.weekday);
  const open = hours?.open === null || hours?.open === undefined ? null : parseClock(hours.open);
  const close = hours?.close === null || hours?.close === undefined ? null : parseClock(hours.close);
  if (localStart.date !== localEnd.date || open === null || close === null || localStart.minutes < open || localEnd.minutes > close) {
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
