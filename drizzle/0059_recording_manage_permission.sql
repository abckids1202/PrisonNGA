INSERT OR IGNORE INTO permissions (id, permission_key, description)
VALUES ('perm-recording-manage', 'recording.manage', 'Start and monitor governed session recordings.');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role-supervisor', id FROM permissions WHERE permission_key = 'recording.manage';
