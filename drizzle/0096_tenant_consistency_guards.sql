-- Keep the denormalized tenant columns authoritative at the database boundary.
-- Route authorization remains required; these guards prevent a trusted writer
-- or migration from attaching a facility record to another organization.

CREATE TRIGGER `appointments_tenant_guard_insert`
BEFORE INSERT ON `appointments`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `appointments_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `appointments`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `waiting_room_sessions_tenant_guard_insert`
BEFORE INSERT ON `waiting_room_sessions`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id = NEW.appointment_id AND a.facility_id = NEW.facility_id AND a.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `waiting_room_sessions_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, appointment_id ON `waiting_room_sessions`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id = NEW.appointment_id AND a.facility_id = NEW.facility_id AND a.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `visit_sessions_tenant_guard_insert`
BEFORE INSERT ON `visit_sessions`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id = NEW.appointment_id AND a.facility_id = NEW.facility_id AND a.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `visit_sessions_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, appointment_id ON `visit_sessions`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id = NEW.appointment_id AND a.facility_id = NEW.facility_id AND a.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `resources_tenant_guard_insert`
BEFORE INSERT ON `resources`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `resources_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `resources`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `resource_reservations_tenant_guard_insert`
BEFORE INSERT ON `resource_reservations`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM resources r WHERE r.id = NEW.resource_id AND r.facility_id = NEW.facility_id AND r.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id = NEW.appointment_id AND a.facility_id = NEW.facility_id AND a.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `resource_reservations_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, resource_id, appointment_id ON `resource_reservations`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM resources r WHERE r.id = NEW.resource_id AND r.facility_id = NEW.facility_id AND r.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id = NEW.appointment_id AND a.facility_id = NEW.facility_id AND a.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `kiosk_credentials_tenant_guard_insert`
BEFORE INSERT ON `kiosk_credentials`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM resources r WHERE r.id = NEW.resource_id AND r.facility_id = NEW.facility_id AND r.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `kiosk_credentials_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, resource_id ON `kiosk_credentials`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM resources r WHERE r.id = NEW.resource_id AND r.facility_id = NEW.facility_id AND r.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `prisoners_tenant_guard_insert`
BEFORE INSERT ON `prisoners`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `prisoners_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `prisoners`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `visitor_relationships_tenant_guard_insert`
BEFORE INSERT ON `visitor_relationships`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM prisoners p WHERE p.id = NEW.prisoner_id AND p.facility_id = NEW.facility_id AND p.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `visitor_relationships_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, prisoner_id ON `visitor_relationships`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM prisoners p WHERE p.id = NEW.prisoner_id AND p.facility_id = NEW.facility_id AND p.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `payment_intents_tenant_guard_insert`
BEFORE INSERT ON `payment_intents`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `payment_intents_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `payment_intents`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `payment_refund_requests_tenant_guard_insert`
BEFORE INSERT ON `payment_refund_requests`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM payment_intents p WHERE p.id = NEW.payment_intent_id AND p.facility_id = NEW.facility_id AND p.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `payment_refund_requests_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, payment_intent_id ON `payment_refund_requests`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM payment_intents p WHERE p.id = NEW.payment_intent_id AND p.facility_id = NEW.facility_id AND p.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;
