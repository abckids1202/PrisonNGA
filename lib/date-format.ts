export const DEFAULT_TIME_ZONE = "Asia/Jakarta";

export function safeTimeZone(timeZone?: string | null) {
  const candidate = timeZone?.trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).resolvedOptions();
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function formatDateValue(value: string | Date, options: Intl.DateTimeFormatOptions, timeZone?: string | null, fallback = "Schedule unavailable") {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: safeTimeZone(timeZone) }).format(date);
  } catch {
    return fallback;
  }
}

export function localDateKey(date: Date, timeZone?: string | null) {
  if (!Number.isFinite(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : "";
  } catch {
    return "";
  }
}

export function addLocalDateDays(date: Date, days: number, timeZone?: string | null) {
  const key = localDateKey(date, timeZone);
  if (!key || !Number.isInteger(days)) return "";
  const [year, month, day] = key.split("-").map(Number);
  if (![year, month, day].every(Number.isInteger)) return "";
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  calendarDate.setUTCDate(calendarDate.getUTCDate() + days);
  return `${calendarDate.getUTCFullYear()}-${String(calendarDate.getUTCMonth() + 1).padStart(2, "0")}-${String(calendarDate.getUTCDate()).padStart(2, "0")}`;
}
