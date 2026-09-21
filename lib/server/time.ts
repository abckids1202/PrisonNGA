/** Convert a facility-local wall-clock value into an ISO instant without assuming Jakarta. */
export function facilityLocalDateTime(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const approximate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(approximate);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const renderedAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
  return new Date(approximate.getTime() + (approximate.getTime() - renderedAsUtc));
}
