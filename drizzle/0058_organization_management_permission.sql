INSERT OR IGNORE INTO permissions (id, permission_key, description)
VALUES ('perm-organization-manage', 'organization.manage', 'Manage organization facilities and organization-level configuration.');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role-supervisor', id FROM permissions WHERE permission_key = 'organization.manage';
