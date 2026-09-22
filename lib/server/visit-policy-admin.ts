export type EditableVisitPolicy = {
  minDurationMinutes: number;
  maxDurationMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  dailyStartTime: string;
  dailyEndTime: string;
};

export function parseEditableVisitPolicy(value: unknown): EditableVisitPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const fields = [body.minDurationMinutes, body.maxDurationMinutes, body.minAdvanceMinutes, body.maxAdvanceDays];
  if (!fields.every((field) => typeof field === "number" && Number.isInteger(field))) return null;
  const [minDurationMinutes, maxDurationMinutes, minAdvanceMinutes, maxAdvanceDays] = fields as number[];
  const dailyStartTime = typeof body.dailyStartTime === "string" ? body.dailyStartTime : "";
  const dailyEndTime = typeof body.dailyEndTime === "string" ? body.dailyEndTime : "";
  const clock = (input: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input)) return null;
    const [hour, minute] = input.split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = clock(dailyStartTime);
  const end = clock(dailyEndTime);
  if (
    minDurationMinutes < 15 || minDurationMinutes > 120 || minDurationMinutes % 15 !== 0 ||
    maxDurationMinutes < minDurationMinutes || maxDurationMinutes > 120 || maxDurationMinutes % 15 !== 0 ||
    minAdvanceMinutes < 0 || minAdvanceMinutes > 10080 ||
    maxAdvanceDays < 1 || maxAdvanceDays > 365 ||
    start === null || end === null || start >= end
  ) return null;
  return { minDurationMinutes, maxDurationMinutes, minAdvanceMinutes, maxAdvanceDays, dailyStartTime, dailyEndTime };
}
