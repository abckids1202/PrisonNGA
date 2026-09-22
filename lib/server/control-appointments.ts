export function controlAppointmentsStatement(d1: D1Database, facilityId: string, status?: string | null): D1PreparedStatement {
  const statusFilter = status ? " AND a.status = ?" : "";
  const values = status ? [facilityId, status] : [facilityId];
  return d1.prepare(`SELECT a.id, a.visitor_user_id, u.display_name AS visitor_name, a.prisoner_id, p.prisoner_number, p.display_name AS prisoner_name,
      a.status, a.requested_start, a.requested_end, a.timezone, a.appointment_type, a.version, a.created_at, a.updated_at,
      p.status AS prisoner_status, p.visitation_status, f.current_state AS facility_state,
      COALESCE(ca.available_credits, 0) AS available_credits, COALESCE(ca.reserved_credits, 0) AS reserved_credits,
      (SELECT vr.relationship_type FROM visitor_relationships vr WHERE vr.facility_id = a.facility_id AND vr.prisoner_id = a.prisoner_id AND vr.visitor_user_id = a.visitor_user_id LIMIT 1) AS relationship_type,
      (SELECT vr.status FROM visitor_relationships vr WHERE vr.facility_id = a.facility_id AND vr.prisoner_id = a.prisoner_id AND vr.visitor_user_id = a.visitor_user_id LIMIT 1) AS relationship_status,
      CASE WHEN EXISTS (SELECT 1 FROM credit_ledger_entries r WHERE r.appointment_id = a.id AND r.credit_account_id = ca.id AND r.entry_type = 'RESERVATION'
        AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t WHERE t.appointment_id = a.id AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))) THEN 1 ELSE 0 END AS active_credit_reservation,
      (SELECT r.display_name FROM resource_reservations rr INNER JOIN resources r ON r.id = rr.resource_id WHERE rr.facility_id = a.facility_id AND rr.appointment_id = a.id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1) AS room_name,
      (SELECT r.display_name FROM resource_reservations rr INNER JOIN resources r ON r.id = rr.resource_id WHERE rr.facility_id = a.facility_id AND rr.appointment_id = a.id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1) AS kiosk_name
    FROM appointments a INNER JOIN users u ON u.id = a.visitor_user_id INNER JOIN prisoners p ON p.id = a.prisoner_id INNER JOIN facilities f ON f.id = a.facility_id
    LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
    WHERE a.facility_id = ?${statusFilter} ORDER BY a.requested_start ASC`).bind(...values);
}
