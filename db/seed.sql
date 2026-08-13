INSERT INTO facilities (id, name, timezone, current_state)
VALUES ('facility-central-001', 'Central Correctional Facility', 'Asia/Jakarta', 'NORMAL_OPERATIONS')
ON CONFLICT(id) DO NOTHING;

INSERT INTO roles (id, name, description) VALUES
  ('role-scheduling-officer', 'Scheduling Officer', 'Reviews and coordinates visitation appointments.'),
  ('role-verification-officer', 'Verification Officer', 'Reviews visitor identity and relationship evidence.'),
  ('role-monitoring-officer', 'Monitoring Officer', 'Monitors authorized active sessions and incidents.'),
  ('role-supervisor', 'Supervisor', 'Approves exceptional actions and facility state changes.'),
  ('role-auditor', 'Auditor', 'Reads compliance records and exports authorized audit reports.')
ON CONFLICT(id) DO NOTHING;

INSERT INTO permissions (id, permission_key, description) VALUES
  ('perm-facility-read', 'facility.read', 'Read facility state and operational context.'),
  ('perm-facility-state-change', 'facility.state.change', 'Change the facility operational state.'),
  ('perm-appointment-review', 'appointment.review', 'Review appointment requests.'),
  ('perm-appointment-approve', 'appointment.approve', 'Approve an appointment after policy checks.'),
  ('perm-verification-review', 'verification.review', 'Review visitor verification records.'),
  ('perm-session-monitor', 'session.monitor', 'View authorized session metadata.'),
  ('perm-audit-read', 'audit.read', 'Read facility-scoped audit events.'),
  ('perm-audit-export', 'audit.export', 'Export an authorized audit report.')
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
  ('role-auditor', 'perm-audit-export')
ON CONFLICT(role_id, permission_id) DO NOTHING;
