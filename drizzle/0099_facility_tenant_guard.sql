-- Facilities are the root of the organization -> facility hierarchy. After
-- the legacy backfill migrations have run, a facility must always point to an
-- active organization and cannot be moved across organization boundaries by a
-- direct database writer.

CREATE TRIGGER `facilities_tenant_guard_insert`
BEFORE INSERT ON `facilities`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id AND o.status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'FACILITY_ORGANIZATION_REQUIRED') END;
END;

CREATE TRIGGER `facilities_tenant_guard_update`
BEFORE UPDATE OF organization_id ON `facilities`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id AND o.status = 'ACTIVE'
  ) THEN RAISE(ABORT, 'FACILITY_ORGANIZATION_REQUIRED') END;
END;
