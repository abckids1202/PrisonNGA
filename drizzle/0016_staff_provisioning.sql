INSERT INTO permissions (id, permission_key, description)
VALUES ('perm-staff-manage', 'staff.manage', 'Provision and manage facility staff accounts.')
ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-supervisor', id FROM permissions WHERE permission_key = 'staff.manage'
ON CONFLICT(role_id, permission_id) DO NOTHING;
