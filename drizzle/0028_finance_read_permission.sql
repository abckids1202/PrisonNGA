INSERT OR IGNORE INTO permissions (id, permission_key, description)
VALUES ('perm-finance-read', 'finance.read', 'Read facility-scoped credit ledger and payment records.');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles, permissions
WHERE roles.name IN ('Supervisor', 'Auditor')
  AND permissions.permission_key = 'finance.read';
