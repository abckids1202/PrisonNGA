INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('role-organization-owner', 'Organization Owner', 'Full organization administration across assigned facilities.'),
  ('role-organization-administrator', 'Organization Administrator', 'Manages organization facilities, memberships, and policy configuration.');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT role_id, id FROM (
  SELECT 'role-organization-owner' AS role_id
  UNION ALL SELECT 'role-organization-administrator'
) role_ids, permissions
WHERE permissions.permission_key = 'organization.manage';
