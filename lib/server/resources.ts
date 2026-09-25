import { SecurityError } from "./security";

export type Allocation = { roomId: string; roomName: string; deviceId: string; deviceName: string; created: boolean };

export async function allocateVisitResources(d1: D1Database, input: { facilityId: string; appointmentId: string; startsAt: string; endsAt: string }): Promise<Allocation> {
  const now = new Date().toISOString();
  const roomId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  let results: Awaited<ReturnType<D1Database["batch"]>>;
  try {
    results = await d1.batch([
      d1.prepare(`INSERT INTO resource_reservations (id, facility_id, appointment_id, resource_type, resource_id, status, starts_at, ends_at, created_at)
        SELECT ?, ?, ?, 'ROOM', (SELECT r.id FROM resources r WHERE r.facility_id = ? AND r.resource_type = 'ROOM' AND r.status = 'AVAILABLE' AND r.health_state = 'HEALTHY'
          AND NOT EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.resource_type = 'ROOM' AND rr.facility_id = ? AND rr.appointment_id <> ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?)
          ORDER BY r.display_name ASC LIMIT 1), 'RESERVED', ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM resource_reservations WHERE appointment_id = ? AND resource_type = 'ROOM' AND status IN ('HELD', 'RESERVED', 'ACTIVE'))`)
        .bind(roomId, input.facilityId, input.appointmentId, input.facilityId, input.facilityId, input.appointmentId, input.endsAt, input.startsAt, input.startsAt, input.endsAt, now, input.appointmentId),
      d1.prepare(`INSERT INTO resource_reservations (id, facility_id, appointment_id, resource_type, resource_id, status, starts_at, ends_at, created_at)
        SELECT ?, ?, ?, 'DEVICE', (SELECT r.id FROM resources r WHERE r.facility_id = ? AND r.resource_type = 'DEVICE' AND r.status = 'ONLINE' AND r.health_state = 'HEALTHY'
          AND NOT EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.resource_type = 'DEVICE' AND rr.facility_id = ? AND rr.appointment_id <> ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?)
          ORDER BY r.display_name ASC LIMIT 1), 'RESERVED', ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM resource_reservations WHERE appointment_id = ? AND resource_type = 'DEVICE' AND status IN ('HELD', 'RESERVED', 'ACTIVE'))`)
        .bind(deviceId, input.facilityId, input.appointmentId, input.facilityId, input.facilityId, input.appointmentId, input.endsAt, input.startsAt, input.startsAt, input.endsAt, now, input.appointmentId),
    ]);
  } catch {
    throw new SecurityError("RESOURCE_RESERVATION_CONFLICT", 409);
  }
  const reserved = await d1.prepare(`SELECT rr.resource_type, rr.resource_id, r.display_name FROM resource_reservations rr INNER JOIN resources r ON r.id = rr.resource_id
    WHERE rr.facility_id = ? AND rr.appointment_id = ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')`).bind(input.facilityId, input.appointmentId).all<{ resource_type: string; resource_id: string; display_name: string }>();
  const room = reserved.results.find((item) => item.resource_type === "ROOM");
  const device = reserved.results.find((item) => item.resource_type === "DEVICE");
  if (!room || !device) throw new SecurityError("RESOURCES_UNAVAILABLE", 409);
  return { roomId: room.resource_id, roomName: room.display_name, deviceId: device.resource_id, deviceName: device.display_name, created: results.some((result) => result.meta.changes > 0) };
}

export async function releaseVisitResources(d1: D1Database, appointmentId: string, facilityId: string) {
  await d1.prepare("UPDATE resource_reservations SET status = 'RELEASED' WHERE appointment_id = ? AND facility_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE')").bind(appointmentId, facilityId).run();
}
