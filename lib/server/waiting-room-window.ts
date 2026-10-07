export const WAITING_ROOM_OPEN_MINUTES = 10;

export function isWaitingRoomOpen(
  requestedStart: string,
  requestedEnd: string,
  now = Date.now(),
  openMinutes = WAITING_ROOM_OPEN_MINUTES,
): boolean {
  const start = Date.parse(requestedStart);
  const end = Date.parse(requestedEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now)) return false;
  if (!Number.isFinite(openMinutes) || openMinutes < 0) return false;
  return now >= start - (openMinutes * 60_000) && now < end;
}
