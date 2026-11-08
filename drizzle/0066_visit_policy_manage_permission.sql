INSERT OR IGNORE INTO permissions (id, permission_key, description)
VALUES ('perm-visit-policy-manage', 'visit_policy.manage', 'Manage facility visitation policy, operating hours, and credit pricing.');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role-supervisor', 'perm-visit-policy-manage'
WHERE EXISTS (SELECT 1 FROM roles WHERE id = 'role-supervisor');
