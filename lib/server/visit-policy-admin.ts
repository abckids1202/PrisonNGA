export type EditableVisitPolicy = {
  minDurationMinutes: number;
  maxDurationMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  dailyStartTime: string;
  dailyEndTime: string;
  creditPriceMinor: number;
  creditCurrency: string;
  weeklyHoursJson: string | null;
};

export function parseEditableVisitPolicy(value: unknown): EditableVisitPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const fields = [body.minDurationMinutes, body.maxDurationMinutes, body.minAdvanceMinutes, body.maxAdvanceDays, body.creditPriceMinor];
  if (!fields.every((field) => typeof field === "number" && Number.isInteger(field))) return null;
  const [minDurationMinutes, maxDurationMinutes, minAdvanceMinutes, maxAdvanceDays, creditPriceMinor] = fields as number[];
  const creditCurrency = typeof body.creditCurrency === "string" ? body.creditCurrency.trim().toUpperCase() : "";
  const dailyStartTime = typeof body.dailyStartTime === "string" ? body.dailyStartTime : "";
  const dailyEndTime = typeof body.dailyEndTime === "string" ? body.dailyEndTime : "";
  const weeklyHours = body.weeklyHours === undefined ? null : body.weeklyHours;
  const clock = (input: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input)) return null;
    const [hour, minute] = input.split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = clock(dailyStartTime);
  const end = clock(dailyEndTime);
  let weeklyHoursJson: string | null = null;
  if (weeklyHours !== null) {
    if (!Array.isArray(weeklyHours) || weeklyHours.length !== 7) return null;
    const normalized = weeklyHours.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const open = record.open === null ? null : typeof record.open === "string" ? record.open : undefined;
      const close = record.close === null ? null : typeof record.close === "string" ? record.close : undefined;
      if (open === undefined || close === undefined) return null;
      if (open === null && close === null) return { open: null, close: null };
      if (open === null || close === null) return null;
      const start = clock(open);
      const finish = clock(close);
      return start !== null && finish !== null && start < finish ? { open, close } : null;
    });
    if (normalized.some((entry) => entry === null)) return null;
    weeklyHoursJson = JSON.stringify(normalized);
  }
  if (
    minDurationMinutes < 15 || minDurationMinutes > 120 || minDurationMinutes % 15 !== 0 ||
    maxDurationMinutes < minDurationMinutes || maxDurationMinutes > 120 || maxDurationMinutes % 15 !== 0 ||
    minAdvanceMinutes < 0 || minAdvanceMinutes > 10080 ||
    maxAdvanceDays < 1 || maxAdvanceDays > 365 ||
    (weeklyHoursJson === null && (start === null || end === null || start >= end)) ||
    creditPriceMinor < 1 || creditPriceMinor > 1_000_000_000 || creditCurrency !== "IDR"
  ) return null;
  return { minDurationMinutes, maxDurationMinutes, minAdvanceMinutes, maxAdvanceDays, dailyStartTime, dailyEndTime, creditPriceMinor, creditCurrency, weeklyHoursJson };
}
