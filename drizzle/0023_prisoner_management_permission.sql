INSERT OR IGNORE INTO permissions (id, permission_key, description)
VALUES ('perm-prisoner-manage', 'prisoner.manage', 'Create and update facility-scoped prisoner visitation records.');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role-supervisor', id FROM permissions WHERE permission_key = 'prisoner.manage';
