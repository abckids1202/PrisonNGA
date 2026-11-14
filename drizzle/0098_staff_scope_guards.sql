-- Staff authorization records are tenant boundaries too. Keep the legacy
-- AFTER-INSERT organization fill paths available, but reject any explicit
-- cross-facility organization values and never allow an organization-level
-- membership to claim a facility from another organization.

CREATE TRIGGER `organization_memberships_tenant_guard_insert`
BEFORE INSERT ON `organization_memberships`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id
  ) OR (NEW.facility_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  )) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `organization_memberships_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `organization_memberships`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id
  ) OR (NEW.facility_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  )) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `organization_role_assignments_tenant_guard_insert`
BEFORE INSERT ON `organization_role_assignments`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `organization_role_assignments_tenant_guard_update`
BEFORE UPDATE OF organization_id ON `organization_role_assignments`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `staff_facility_assignments_tenant_guard_insert`
BEFORE INSERT ON `staff_facility_assignments`
FOR EACH ROW
WHEN NEW.organization_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `staff_facility_assignments_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `staff_facility_assignments`
FOR EACH ROW
WHEN NEW.organization_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `user_roles_tenant_guard_insert`
BEFORE INSERT ON `user_roles`
FOR EACH ROW
WHEN NEW.organization_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `user_roles_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `user_roles`
FOR EACH ROW
WHEN NEW.organization_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `staff_profiles_tenant_guard_insert`
BEFORE INSERT ON `staff_profiles`
FOR EACH ROW
WHEN NEW.organization_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `staff_profiles_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `staff_profiles`
FOR EACH ROW
WHEN NEW.organization_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;
