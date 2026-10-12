-- Synthetic staging fixture only. Never run this against production.
-- This fixture intentionally creates no staff sessions, visitor sessions,
-- kiosk credentials, payment records, or identity evidence. Those records
-- must be created through the real staging workflows and providers.

INSERT OR IGNORE INTO facilities (id, name, timezone, current_state)
VALUES ('facility-staging-001', 'SecureVisit Staging Facility', 'Asia/Jakarta', 'NORMAL_OPERATIONS');

INSERT OR IGNORE INTO visit_policies (id, facility_id, min_duration_minutes, max_duration_minutes, min_advance_minutes, max_advance_days, daily_start_time, daily_end_time, credit_price_minor, credit_currency, version)
VALUES ('policy-staging-default', 'facility-staging-001', 15, 30, 60, 30, '08:00', '17:00', NULL, 'IDR', 1);

INSERT OR IGNORE INTO appointment_types (id, facility_id, code, display_name, description, duration_minutes, credit_cost, status, version)
VALUES ('appointment-type-staging-family', 'facility-staging-001', 'FAMILY', 'Family visit', 'Synthetic staging family visit.', 30, 1, 'ACTIVE', 1);

INSERT OR IGNORE INTO prisoners (id, facility_id, prisoner_number, display_name, housing_unit, status, visitation_status)
VALUES ('prisoner-staging-001', 'facility-staging-001', 'STAGING-001', 'Synthetic Prisoner One', 'Synthetic Unit', 'ACTIVE', 'APPROVED');

INSERT OR IGNORE INTO resources (id, facility_id, resource_type, display_name, status, room_id, health_state, last_heartbeat_at)
VALUES
  ('room-staging-01', 'facility-staging-001', 'ROOM', 'Staging Room 01', 'AVAILABLE', NULL, 'HEALTHY', CURRENT_TIMESTAMP),
  ('kiosk-staging-01', 'facility-staging-001', 'DEVICE', 'Staging Kiosk 01', 'ONLINE', 'room-staging-01', 'HEALTHY', CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('role-scheduling-officer', 'Scheduling Officer', 'Reviews and coordinates visitation appointments.'),
  ('role-verification-officer', 'Verification Officer', 'Reviews visitor identity and relationship evidence.'),
  ('role-monitoring-officer', 'Monitoring Officer', 'Monitors authorized active sessions and incidents.'),
  ('role-supervisor', 'Supervisor', 'Approves exceptional actions and facility state changes.'),
  ('role-auditor', 'Auditor', 'Reads compliance records and exports authorized audit reports.');

INSERT OR IGNORE INTO permissions (id, permission_key, description) VALUES
  ('perm-facility-read', 'facility.read', 'Read facility state and operational context.'),
  ('perm-appointment-review', 'appointment.review', 'Review appointment requests.'),
  ('perm-appointment-approve', 'appointment.approve', 'Approve appointments after policy checks.'),
  ('perm-verification-review', 'verification.review', 'Review visitor verification evidence.'),
  ('perm-session-monitor', 'session.monitor', 'View authorized session metadata.'),
  ('perm-audit-read', 'audit.read', 'Read facility-scoped audit events.'),
  ('perm-audit-export', 'audit.export', 'Export authorized audit reports.'),
  ('perm-staff-manage', 'staff.manage', 'Provision and manage facility staff accounts.'),
  ('perm-incident-read', 'incident.read', 'Read facility incident records.'),
  ('perm-incident-manage', 'incident.manage', 'Create and resolve facility incidents.'),
  ('perm-notification-manage', 'notification.manage', 'Replay and operate failed notification deliveries.'),
  ('perm-visitor-directory-read', 'visitor.directory.read', 'Read facility-scoped visitor directory data.'),
  ('perm-finance-read', 'finance.read', 'Read facility-scoped credit and payment records.'),
  ('perm-finance-manage', 'finance.manage', 'Operate facility payment exceptions.');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role-scheduling-officer', 'perm-facility-read'),
  ('role-scheduling-officer', 'perm-appointment-review'),
  ('role-scheduling-officer', 'perm-appointment-approve'),
  ('role-verification-officer', 'perm-facility-read'),
  ('role-verification-officer', 'perm-verification-review'),
  ('role-monitoring-officer', 'perm-facility-read'),
  ('role-monitoring-officer', 'perm-session-monitor'),
  ('role-supervisor', 'perm-facility-read'),
  ('role-supervisor', 'perm-appointment-review'),
  ('role-supervisor', 'perm-appointment-approve'),
  ('role-supervisor', 'perm-verification-review'),
  ('role-supervisor', 'perm-session-monitor'),
  ('role-supervisor', 'perm-audit-read'),
  ('role-supervisor', 'perm-staff-manage'),
  ('role-supervisor', 'perm-incident-read'),
  ('role-supervisor', 'perm-incident-manage'),
  ('role-supervisor', 'perm-notification-manage'),
  ('role-supervisor', 'perm-visitor-directory-read'),
  ('role-supervisor', 'perm-finance-read'),
  ('role-supervisor', 'perm-finance-manage'),
  ('role-auditor', 'perm-facility-read'),
  ('role-auditor', 'perm-audit-read'),
  ('role-auditor', 'perm-audit-export');
