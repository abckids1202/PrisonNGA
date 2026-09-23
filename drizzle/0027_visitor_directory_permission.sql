INSERT OR IGNORE INTO permissions (id, permission_key, description)
VALUES ('perm-visitor-directory-read', 'visitor.directory.read', 'Read facility-scoped visitor identity and relationship directory data.');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles, permissions
WHERE roles.name IN ('Scheduling Officer', 'Verification Officer', 'Supervisor')
  AND permissions.permission_key = 'visitor.directory.read';
