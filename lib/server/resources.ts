import { SecurityError } from "./security";

type Allocation = { roomId: string; roomName: string; deviceId: string; deviceName: string };

async function findAvailable(d1: D1Database, input: { facilityId: string; type: "ROOM" | "DEVICE"; startsAt: string; endsAt: string; appointmentId: string }) {
  const deviceFilter = input.type === "DEVICE" ? "AND r.status = 'ONLINE'" : "AND r.status = 'AVAILABLE'";
  return d1.prepare(`SELECT r.id, r.display_name FROM resources r WHERE r.facility_id = ? AND r.resource_type = ? ${deviceFilter} AND NOT EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.resource_type = ? AND rr.facility_id = ? AND rr.appointment_id <> ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?) ORDER BY r.display_name ASC LIMIT 1`).bind(input.facilityId, input.type, input.type, input.facilityId, input.appointmentId, input.endsAt, input.startsAt).first<{ id: string; display_name: string }>();
}

export async function allocateVisitResources(d1: D1Database, input: { facilityId: string; appointmentId: string; startsAt: string; endsAt: string }) {
  const room = await findAvailable(d1, { ...input, type: "ROOM" });
  const device = await findAvailable(d1, { ...input, type: "DEVICE" });
  if (!room || !device) throw new SecurityError("RESOURCES_UNAVAILABLE", 409);
  const now = new Date().toISOString();
  try {
    await d1.batch([
      d1.prepare(`INSERT INTO resource_reservations (id, facility_id, appointment_id, resource_type, resource_id, status, starts_at, ends_at, created_at) VALUES (?, ?, ?, 'ROOM', ?, 'RESERVED', ?, ?, ?)`)
        .bind(crypto.randomUUID(), input.facilityId, input.appointmentId, room.id, input.startsAt, input.endsAt, now),
      d1.prepare(`INSERT INTO resource_reservations (id, facility_id, appointment_id, resource_type, resource_id, status, starts_at, ends_at, created_at) VALUES (?, ?, ?, 'DEVICE', ?, 'RESERVED', ?, ?, ?)`)
        .bind(crypto.randomUUID(), input.facilityId, input.appointmentId, device.id, input.startsAt, input.endsAt, now),
    ]);
  } catch {
    throw new SecurityError("RESOURCE_RESERVATION_CONFLICT", 409);
  }
  return { roomId: room.id, roomName: room.display_name, deviceId: device.id, deviceName: device.display_name } satisfies Allocation;
}

export async function releaseVisitResources(d1: D1Database, appointmentId: string, facilityId: string) {
  await d1.prepare("UPDATE resource_reservations SET status = 'RELEASED' WHERE appointment_id = ? AND facility_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE')").bind(appointmentId, facilityId).run();
}

