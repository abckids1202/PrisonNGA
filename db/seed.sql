INSERT INTO facilities (id, name, timezone, current_state)
VALUES ('facility-central-001', 'Central Correctional Facility', 'Asia/Jakarta', 'NORMAL_OPERATIONS')
ON CONFLICT(id) DO NOTHING;

INSERT INTO visit_policies (id, facility_id, min_duration_minutes, max_duration_minutes, min_advance_minutes, max_advance_days, daily_start_time, daily_end_time, version)
VALUES ('policy-central-default', 'facility-central-001', 15, 30, 60, 30, '08:00', '17:00', 1)
ON CONFLICT(facility_id) DO NOTHING;

INSERT INTO appointment_types (id, facility_id, code, display_name, description, duration_minutes, credit_cost, status, version)
VALUES
  ('appointment-type-family-central', 'facility-central-001', 'FAMILY', 'Family visit', 'Standard approved visitor relationship visit.', 30, 1, 'ACTIVE', 1),
  ('appointment-type-legal-central', 'facility-central-001', 'LEGAL', 'Legal visit', 'Professional or legal representative visit subject to facility review.', 30, 1, 'ACTIVE', 1)
ON CONFLICT(facility_id, code) DO NOTHING;

INSERT INTO prisoners (id, facility_id, prisoner_number, display_name, housing_unit, status, visitation_status)
VALUES ('prisoner-ar-001', 'facility-central-001', 'AR-2041', 'A. Rahman', 'Unit 4', 'ACTIVE', 'APPROVED')
ON CONFLICT(id) DO NOTHING;

-- Local-only staff identity used by browser acceptance tests. This seed is never
-- applied by the remote migration command and does not bypass production SSO.
INSERT INTO users (id, external_id, email, display_name, user_type, status, email_verified_at)
VALUES ('staff-local-supervisor', 'staff-local-supervisor', 'staff.local@example.test', 'Local Supervisor', 'STAFF', 'ACTIVE', CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;

INSERT INTO staff_profiles (user_id, facility_id, employee_reference, job_title, department)
VALUES ('staff-local-supervisor', 'facility-central-001', 'LOCAL-001', 'Pilot Supervisor', 'Operations')
ON CONFLICT(user_id) DO NOTHING;

INSERT INTO resources (id, facility_id, resource_type, display_name, status, room_id, health_state, last_heartbeat_at)
VALUES
  ('room-01', 'facility-central-001', 'ROOM', 'Room 01', 'AVAILABLE', NULL, 'HEALTHY', CURRENT_TIMESTAMP),
  ('room-02', 'facility-central-001', 'ROOM', 'Room 02', 'AVAILABLE', NULL, 'HEALTHY', CURRENT_TIMESTAMP),
  ('room-03', 'facility-central-001', 'ROOM', 'Room 03', 'AVAILABLE', NULL, 'HEALTHY', CURRENT_TIMESTAMP),
  ('room-04', 'facility-central-001', 'ROOM', 'Room 04', 'AVAILABLE', NULL, 'HEALTHY', CURRENT_TIMESTAMP),
  ('kiosk-02', 'facility-central-001', 'DEVICE', 'Kiosk 02', 'ONLINE', 'room-01', 'HEALTHY', CURRENT_TIMESTAMP),
  ('kiosk-04', 'facility-central-001', 'DEVICE', 'Kiosk 04', 'OFFLINE', 'room-03', 'FAILED', datetime('now', '-14 minutes')),
  ('kiosk-06', 'facility-central-001', 'DEVICE', 'Kiosk 06', 'ONLINE', NULL, 'HEALTHY', CURRENT_TIMESTAMP),
  ('kiosk-08', 'facility-central-001', 'DEVICE', 'Kiosk 08', 'MAINTENANCE', NULL, 'WARNING', CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;

-- Local-only kiosk acceptance credential. The raw secret is intentionally not stored;
-- browser acceptance tests provide it through the controlled-device header boundary.
INSERT INTO kiosk_credentials (id, facility_id, resource_id, credential_hash, status, created_by, created_at)
VALUES ('credential-local-e2e-kiosk-02', 'facility-central-001', 'kiosk-02', '5537616105e030399d09f6aef4f4ecaae220fd45192dea09015533cad1ac554e', 'ACTIVE', 'staff-local-supervisor', CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;

INSERT INTO roles (id, name, description) VALUES
  ('role-scheduling-officer', 'Scheduling Officer', 'Reviews and coordinates visitation appointments.'),
  ('role-verification-officer', 'Verification Officer', 'Reviews visitor identity and relationship evidence.'),
  ('role-monitoring-officer', 'Monitoring Officer', 'Monitors authorized active sessions and incidents.'),
  ('role-supervisor', 'Supervisor', 'Approves exceptional actions and facility state changes.'),
  ('role-auditor', 'Auditor', 'Reads compliance records and exports authorized audit reports.')
ON CONFLICT(id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id, facility_id, assigned_by)
VALUES ('staff-local-supervisor', 'role-supervisor', 'facility-central-001', 'local-seed')
ON CONFLICT(user_id, role_id, facility_id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id, facility_id, assigned_by)
VALUES ('staff-local-supervisor', 'role-verification-officer', 'facility-central-001', 'local-seed')
ON CONFLICT(user_id, role_id, facility_id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id, facility_id, assigned_by)
VALUES ('staff-local-supervisor', 'role-scheduling-officer', 'facility-central-001', 'local-seed')
ON CONFLICT(user_id, role_id, facility_id) DO NOTHING;

INSERT INTO permissions (id, permission_key, description) VALUES
  ('perm-facility-read', 'facility.read', 'Read facility state and operational context.'),
  ('perm-facility-state-change', 'facility.state.change', 'Change the facility operational state.'),
  ('perm-appointment-review', 'appointment.review', 'Review appointment requests.'),
  ('perm-appointment-approve', 'appointment.approve', 'Approve an appointment after policy checks.'),
  ('perm-verification-review', 'verification.review', 'Review visitor verification records.'),
  ('perm-session-monitor', 'session.monitor', 'View authorized session metadata.'),
  ('perm-audit-read', 'audit.read', 'Read facility-scoped audit events.'),
  ('perm-audit-export', 'audit.export', 'Export an authorized audit report.'),
  ('perm-staff-manage', 'staff.manage', 'Provision and manage facility staff accounts.'),
  ('perm-incident-read', 'incident.read', 'Read facility incident records.'),
  ('perm-incident-manage', 'incident.manage', 'Create and resolve facility incidents.'),
  ('perm-notification-manage', 'notification.manage', 'Replay and operate failed notification deliveries.')
  ,('perm-visitor-directory-read', 'visitor.directory.read', 'Read facility-scoped visitor identity and relationship directory data.')
  ,('perm-finance-read', 'finance.read', 'Read facility-scoped credit ledger and payment records.')
  ,('perm-finance-manage', 'finance.manage', 'Request provider refunds and operate facility payment exceptions.')
  ,('perm-break-glass-request', 'access.break_glass.request', 'Request controlled emergency access to a sensitive facility record.')
  ,('perm-break-glass-approve', 'access.break_glass.approve', 'Approve, deny, or revoke controlled emergency access.')
ON CONFLICT(id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('role-scheduling-officer', 'perm-facility-read'),
  ('role-scheduling-officer', 'perm-appointment-review'),
  ('role-scheduling-officer', 'perm-appointment-approve'),
  ('role-verification-officer', 'perm-facility-read'),
  ('role-verification-officer', 'perm-verification-review'),
  ('role-monitoring-officer', 'perm-facility-read'),
  ('role-monitoring-officer', 'perm-session-monitor'),
  ('role-supervisor', 'perm-facility-read'),
  ('role-supervisor', 'perm-facility-state-change'),
  ('role-supervisor', 'perm-audit-read'),
  ('role-auditor', 'perm-facility-read'),
  ('role-auditor', 'perm-audit-read'),
  ('role-auditor', 'perm-audit-export'),
  ('role-monitoring-officer', 'perm-incident-read'),
  ('role-monitoring-officer', 'perm-incident-manage'),
  ('role-supervisor', 'perm-incident-read'),
  ('role-supervisor', 'perm-incident-manage'),
  ('role-auditor', 'perm-incident-read'),
  ('role-supervisor', 'perm-notification-manage')
  ,('role-supervisor', 'perm-staff-manage')
  ,('role-scheduling-officer', 'perm-visitor-directory-read')
  ,('role-verification-officer', 'perm-visitor-directory-read')
  ,('role-supervisor', 'perm-visitor-directory-read')
  ,('role-supervisor', 'perm-finance-read')
  ,('role-auditor', 'perm-finance-read')
  ,('role-supervisor', 'perm-finance-manage')
  ,('role-scheduling-officer', 'perm-break-glass-request')
  ,('role-verification-officer', 'perm-break-glass-request')
  ,('role-monitoring-officer', 'perm-break-glass-request')
  ,('role-supervisor', 'perm-break-glass-request')
  ,('role-supervisor', 'perm-break-glass-approve')
ON CONFLICT(role_id, permission_id) DO NOTHING;
