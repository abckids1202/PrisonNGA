export function visitorDirectoryStatement(d1: D1Database, facilityId: string, now: string) {
  return d1.prepare(`SELECT
      u.id AS visitor_user_id,
      u.external_id AS visitor_reference,
      COALESCE(NULLIF(vp.preferred_name, ''), vp.legal_name, u.display_name) AS display_name,
      u.status AS account_status,
      vp.profile_status,
      (SELECT vr.relationship_type FROM visitor_relationships vr
        WHERE vr.facility_id = ? AND vr.visitor_user_id = u.id
        ORDER BY CASE vr.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, vr.updated_at DESC LIMIT 1) AS relationship_type,
      (SELECT vr.status FROM visitor_relationships vr
        WHERE vr.facility_id = ? AND vr.visitor_user_id = u.id
        ORDER BY CASE vr.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, vr.updated_at DESC LIMIT 1) AS relationship_status,
      (SELECT p.display_name FROM visitor_relationships vr INNER JOIN prisoners p
        ON p.id = vr.prisoner_id AND p.facility_id = vr.facility_id
        WHERE vr.facility_id = ? AND vr.visitor_user_id = u.id
        ORDER BY CASE vr.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, vr.updated_at DESC LIMIT 1) AS prisoner_name,
      (SELECT vc.status FROM visitor_relationships vr INNER JOIN verification_cases vc
        ON vc.relationship_id = vr.id AND vc.facility_id = vr.facility_id
        WHERE vr.facility_id = ? AND vr.visitor_user_id = u.id
        ORDER BY vc.submitted_at DESC LIMIT 1) AS verification_status,
      (SELECT a.id FROM appointments a WHERE a.facility_id = ? AND a.visitor_user_id = u.id
        AND a.status IN ('APPROVED', 'WAITING', 'IN_PROGRESS') AND a.requested_start >= ?
        ORDER BY a.requested_start LIMIT 1) AS next_appointment_id,
      (SELECT a.requested_start FROM appointments a WHERE a.facility_id = ? AND a.visitor_user_id = u.id
        AND a.status IN ('APPROVED', 'WAITING', 'IN_PROGRESS') AND a.requested_start >= ?
        ORDER BY a.requested_start LIMIT 1) AS next_visit_at,
      (SELECT r.display_name FROM appointments a
        INNER JOIN resource_reservations rr ON rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('RESERVED', 'ACTIVE')
        INNER JOIN resources r ON r.id = rr.resource_id AND r.facility_id = a.facility_id
        WHERE a.facility_id = ? AND a.visitor_user_id = u.id AND a.status IN ('APPROVED', 'WAITING', 'IN_PROGRESS') AND a.requested_start >= ?
        ORDER BY a.requested_start LIMIT 1) AS next_room
    FROM users u
    INNER JOIN visitor_profiles vp ON vp.user_id = u.id
    WHERE u.user_type = 'VISITOR' AND u.status <> 'DISABLED'
      AND (EXISTS (SELECT 1 FROM visitor_relationships vr WHERE vr.facility_id = ? AND vr.visitor_user_id = u.id)
        OR EXISTS (SELECT 1 FROM appointments a WHERE a.facility_id = ? AND a.visitor_user_id = u.id))
    ORDER BY display_name COLLATE NOCASE LIMIT 250`)
    .bind(facilityId, facilityId, facilityId, facilityId, facilityId, now, facilityId, now, facilityId, now, facilityId, facilityId);
}

export function peopleDirectoryCountsStatement(d1: D1Database, facilityId: string) {
  return d1.prepare(`SELECT
      (SELECT COUNT(DISTINCT u.id) FROM users u INNER JOIN visitor_profiles vp ON vp.user_id = u.id
        WHERE u.user_type = 'VISITOR' AND u.status <> 'DISABLED'
          AND (EXISTS (SELECT 1 FROM visitor_relationships vr WHERE vr.facility_id = ? AND vr.visitor_user_id = u.id)
            OR EXISTS (SELECT 1 FROM appointments a WHERE a.facility_id = ? AND a.visitor_user_id = u.id))) AS visitors,
      (SELECT COUNT(*) FROM prisoners WHERE facility_id = ?) AS prisoners,
      (SELECT COUNT(*) FROM verification_cases WHERE facility_id = ? AND status IN ('PENDING', 'IN_REVIEW', 'MORE_INFO')) AS awaiting_verification,
      (SELECT COUNT(*) FROM visitor_relationships WHERE facility_id = ? AND status = 'PENDING') AS relationship_requests`)
    .bind(facilityId, facilityId, facilityId, facilityId, facilityId);
}

export function pendingRelationshipDirectoryStatement(d1: D1Database, facilityId: string) {
  return d1.prepare(`SELECT
      vr.id AS relationship_id,
      u.id AS visitor_user_id,
      u.external_id AS visitor_reference,
      COALESCE(NULLIF(vp.preferred_name, ''), vp.legal_name, u.display_name) AS visitor_name,
      p.display_name AS prisoner_name,
      vr.relationship_type,
      vr.status AS relationship_status,
      vc.status AS verification_status
    FROM visitor_relationships vr
    INNER JOIN users u ON u.id = vr.visitor_user_id AND u.user_type = 'VISITOR' AND u.status <> 'DISABLED'
    INNER JOIN visitor_profiles vp ON vp.user_id = u.id
    INNER JOIN prisoners p ON p.id = vr.prisoner_id AND p.facility_id = vr.facility_id
    LEFT JOIN verification_cases vc ON vc.relationship_id = vr.id AND vc.facility_id = vr.facility_id
    WHERE vr.facility_id = ? AND vr.status = 'PENDING'
    ORDER BY vr.created_at LIMIT 250`).bind(facilityId);
}
