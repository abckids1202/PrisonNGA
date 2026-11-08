DELETE FROM role_permissions
WHERE role_id = 'role-supervisor'
  AND permission_id IN (SELECT id FROM permissions WHERE permission_key = 'organization.manage');
