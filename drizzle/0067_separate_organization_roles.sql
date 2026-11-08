DELETE FROM role_permissions
WHERE role_id = 'role-supervisor'
  AND permission_id IN (SELECT id FROM permissions WHERE permission_key = 'organization.manage');
--> statement-breakpoint
UPDATE organization_role_assignments
SET status = 'REVOKED', version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE role_id = 'role-supervisor' AND status = 'ACTIVE';
