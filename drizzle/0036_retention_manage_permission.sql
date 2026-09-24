INSERT INTO permissions (id, permission_key, description)
VALUES ('perm-retention-manage', 'retention.manage', 'Change facility evidence retention policies.')
ON CONFLICT(permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles, permissions
WHERE roles.id = 'role-supervisor'
  AND permissions.permission_key = 'retention.manage'
ON CONFLICT(role_id, permission_id) DO NOTHING;
