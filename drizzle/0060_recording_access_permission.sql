-- Recordings are more sensitive than ordinary live-session metadata. Keep
-- inventory and playback behind the dedicated recording permission instead of
-- the broader session-monitor permission.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'recording.manage'
WHERE r.name IN ('Monitoring Officer', 'Supervisor');
