INSERT OR IGNORE INTO permissions (id, permission_key, description) VALUES ('perm-notification-manage', 'notification.manage', 'Replay and operate failed notification deliveries.');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role-supervisor', 'perm-notification-manage');
