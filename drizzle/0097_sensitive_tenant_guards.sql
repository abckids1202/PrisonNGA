-- Extend fail-closed tenant consistency to sensitive records that were added
-- before the core workflow guards. Organization scope is denormalized for
-- indexed authorization, so every writer must keep it aligned to the facility
-- and to any parent record.

CREATE TRIGGER `verification_cases_tenant_guard_insert`
BEFORE INSERT ON `verification_cases`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM visitor_relationships vr WHERE vr.id = NEW.relationship_id AND vr.facility_id = NEW.facility_id AND vr.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `verification_cases_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, relationship_id ON `verification_cases`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM visitor_relationships vr WHERE vr.id = NEW.relationship_id AND vr.facility_id = NEW.facility_id AND vr.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `evidence_documents_tenant_guard_insert`
BEFORE INSERT ON `evidence_documents`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM verification_cases vc WHERE vc.id = NEW.verification_case_id AND vc.facility_id = NEW.facility_id AND vc.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `evidence_documents_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, verification_case_id ON `evidence_documents`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM verification_cases vc WHERE vc.id = NEW.verification_case_id AND vc.facility_id = NEW.facility_id AND vc.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `incidents_tenant_guard_insert`
BEFORE INSERT ON `incidents`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR (NEW.appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id = NEW.appointment_id AND a.facility_id = NEW.facility_id AND a.organization_id = NEW.organization_id
  )) OR (NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM visit_sessions vs WHERE vs.id = NEW.session_id AND vs.facility_id = NEW.facility_id AND vs.organization_id = NEW.organization_id
  )) OR (NEW.resource_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM resources r WHERE r.id = NEW.resource_id AND r.facility_id = NEW.facility_id AND r.organization_id = NEW.organization_id
  )) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `incidents_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, appointment_id, session_id, resource_id ON `incidents`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR (NEW.appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id = NEW.appointment_id AND a.facility_id = NEW.facility_id AND a.organization_id = NEW.organization_id
  )) OR (NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM visit_sessions vs WHERE vs.id = NEW.session_id AND vs.facility_id = NEW.facility_id AND vs.organization_id = NEW.organization_id
  )) OR (NEW.resource_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM resources r WHERE r.id = NEW.resource_id AND r.facility_id = NEW.facility_id AND r.organization_id = NEW.organization_id
  )) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `visit_policies_tenant_guard_insert`
BEFORE INSERT ON `visit_policies`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `visit_policies_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `visit_policies`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `appointment_types_tenant_guard_insert`
BEFORE INSERT ON `appointment_types`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `appointment_types_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `appointment_types`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `credit_accounts_tenant_guard_insert`
BEFORE INSERT ON `credit_accounts`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `credit_accounts_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `credit_accounts`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `recordings_tenant_guard_insert`
BEFORE INSERT ON `recordings`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM visit_sessions vs WHERE vs.id = NEW.session_id AND vs.facility_id = NEW.facility_id AND vs.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `recordings_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, session_id ON `recordings`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM visit_sessions vs WHERE vs.id = NEW.session_id AND vs.facility_id = NEW.facility_id AND vs.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `recording_consents_tenant_guard_insert`
BEFORE INSERT ON `recording_consents`
FOR EACH ROW
WHEN NEW.organization_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM visit_sessions vs WHERE vs.id = NEW.session_id AND vs.facility_id = NEW.facility_id AND vs.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `recording_consents_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id, session_id ON `recording_consents`
FOR EACH ROW
WHEN NEW.organization_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM visit_sessions vs WHERE vs.id = NEW.session_id AND vs.facility_id = NEW.facility_id AND vs.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `legal_holds_tenant_guard_insert`
BEFORE INSERT ON `legal_holds`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `legal_holds_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `legal_holds`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `retention_policies_tenant_guard_insert`
BEFORE INSERT ON `retention_policies`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER `retention_policies_tenant_guard_update`
BEFORE UPDATE OF organization_id, facility_id ON `retention_policies`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM facilities f WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'TENANT_SCOPE_MISMATCH') END;
END;
