INSERT INTO permissions (id, permission_key, description)
VALUES ('perm-legal-hold-manage', 'legal_hold.manage', 'Create and release facility legal holds.')
ON CONFLICT(permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles, permissions
WHERE roles.id IN ('role-supervisor', 'role-auditor')
  AND permissions.permission_key = 'legal_hold.manage'
ON CONFLICT(role_id, permission_id) DO NOTHING;
