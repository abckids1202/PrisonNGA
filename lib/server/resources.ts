import { SecurityError } from "./security";

export type Allocation = { roomId: string; roomName: string; deviceId: string; deviceName: string; created: boolean };

export async function allocateVisitResources(d1: D1Database, input: { facilityId: string; appointmentId: string; startsAt: string; endsAt: string }): Promise<Allocation> {
  const now = new Date().toISOString();
  const roomId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  let results: Awaited<ReturnType<D1Database["batch"]>>;
  try {
    results = await d1.batch([
      d1.prepare(`INSERT INTO resource_reservations (id, organization_id, facility_id, appointment_id, resource_type, resource_id, status, starts_at, ends_at, created_at)
        SELECT ?, (SELECT f.organization_id FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?), ?, ?, 'ROOM', (SELECT r.id FROM resources r WHERE r.facility_id = ? AND r.resource_type = 'ROOM' AND r.status = 'AVAILABLE' AND r.health_state = 'HEALTHY'
          AND NOT EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.resource_type = 'ROOM' AND rr.facility_id = ? AND rr.appointment_id <> ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?)
          ORDER BY r.display_name ASC LIMIT 1), 'RESERVED', ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM resource_reservations WHERE appointment_id = ? AND resource_type = 'ROOM' AND status IN ('HELD', 'RESERVED', 'ACTIVE'))
          AND EXISTS (SELECT 1 FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?)`)
        .bind(roomId, input.facilityId, input.facilityId, input.appointmentId, input.facilityId, input.facilityId, input.appointmentId, input.endsAt, input.startsAt, input.startsAt, input.endsAt, now, input.appointmentId, input.facilityId),
      d1.prepare(`INSERT INTO resource_reservations (id, organization_id, facility_id, appointment_id, resource_type, resource_id, status, starts_at, ends_at, created_at)
        SELECT ?, (SELECT f.organization_id FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?), ?, ?, 'DEVICE', (SELECT r.id FROM resources r WHERE r.facility_id = ? AND r.resource_type = 'DEVICE' AND r.status = 'ONLINE' AND r.health_state = 'HEALTHY'
          AND r.last_heartbeat_at IS NOT NULL AND julianday(r.last_heartbeat_at) >= julianday('now', '-3 minutes')
          AND NOT EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.resource_id = r.id AND rr.resource_type = 'DEVICE' AND rr.facility_id = ? AND rr.appointment_id <> ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') AND rr.starts_at < ? AND rr.ends_at > ?)
          ORDER BY r.display_name ASC LIMIT 1), 'RESERVED', ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM resource_reservations WHERE appointment_id = ? AND resource_type = 'DEVICE' AND status IN ('HELD', 'RESERVED', 'ACTIVE'))
          AND EXISTS (SELECT 1 FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?)`)
        .bind(deviceId, input.facilityId, input.facilityId, input.appointmentId, input.facilityId, input.facilityId, input.appointmentId, input.endsAt, input.startsAt, input.startsAt, input.endsAt, now, input.appointmentId, input.facilityId),
    ]);
  } catch {
    throw new SecurityError("RESOURCE_RESERVATION_CONFLICT", 409);
  }
  const roomCreated = Number(results[0]?.meta.changes || 0) > 0;
  const deviceCreated = Number(results[1]?.meta.changes || 0) > 0;
  if (roomCreated !== deviceCreated) {
    const orphanReservationId = roomCreated ? roomId : deviceId;
    const removed = await d1.prepare("DELETE FROM resource_reservations WHERE id = ? AND facility_id = ? AND appointment_id = ? AND status = 'RESERVED' AND EXISTS (SELECT 1 FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?)")
      .bind(orphanReservationId, input.facilityId, input.appointmentId, input.facilityId).run();
    if (!removed.meta.changes) throw new SecurityError("RESOURCE_RESERVATION_RECONCILIATION_REQUIRED", 503);
    throw new SecurityError("RESOURCE_RESERVATION_CONFLICT", 409);
  }
  const reserved = await d1.prepare(`SELECT rr.resource_type, rr.resource_id, r.display_name FROM resource_reservations rr INNER JOIN resources r ON r.id = rr.resource_id AND r.facility_id = rr.facility_id INNER JOIN facilities f ON f.id = rr.facility_id AND f.organization_id = rr.organization_id INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE'
    WHERE rr.facility_id = ? AND rr.appointment_id = ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')`).bind(input.facilityId, input.appointmentId).all<{ resource_type: string; resource_id: string; display_name: string }>();
  const room = reserved.results.find((item) => item.resource_type === "ROOM");
  const device = reserved.results.find((item) => item.resource_type === "DEVICE");
  if (!room || !device) {
    const createdIds = [roomCreated ? roomId : null, deviceCreated ? deviceId : null].filter((id): id is string => Boolean(id));
    if (createdIds.length) {
      const cleanup = await d1.prepare("DELETE FROM resource_reservations WHERE id IN (?, ?) AND facility_id = ? AND appointment_id = ? AND status = 'RESERVED' AND EXISTS (SELECT 1 FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?)")
        .bind(createdIds[0] || "", createdIds[1] || "", input.facilityId, input.appointmentId, input.facilityId).run();
      if (cleanup.meta.changes !== createdIds.length) throw new SecurityError("RESOURCE_RESERVATION_RECONCILIATION_REQUIRED", 503);
    }
    throw new SecurityError("RESOURCES_UNAVAILABLE", 409);
  }
  return { roomId: room.resource_id, roomName: room.display_name, deviceId: device.resource_id, deviceName: device.display_name, created: results.some((result) => result.meta.changes > 0) };
}

export async function releaseVisitResources(d1: D1Database, appointmentId: string, facilityId: string) {
  await d1.prepare("UPDATE resource_reservations SET status = 'RELEASED' WHERE appointment_id = ? AND facility_id = ? AND status IN ('HELD', 'RESERVED', 'ACTIVE') AND EXISTS (SELECT 1 FROM facilities f INNER JOIN organizations o ON o.id = f.organization_id AND o.status = 'ACTIVE' WHERE f.id = ?)").bind(appointmentId, facilityId, facilityId).run();
}
