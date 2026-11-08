INSERT OR IGNORE INTO permissions (id, permission_key, description)
VALUES ('perm-appointment-type-manage', 'appointment_type.manage', 'Manage facility appointment types and their visitor-facing eligibility.');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role-supervisor', 'perm-appointment-type-manage'
WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'role-supervisor');
