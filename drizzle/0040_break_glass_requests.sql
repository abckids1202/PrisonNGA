CREATE TABLE `break_glass_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL,
  `requested_by` text NOT NULL,
  `approved_by` text,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `reason` text NOT NULL,
  `duration_minutes` integer DEFAULT 30 NOT NULL,
  `decision_reason` text,
  `status` text DEFAULT 'PENDING' NOT NULL,
  `expires_at` text,
  `approved_at` text,
  `revoked_at` text,
  `version` integer DEFAULT 1 NOT NULL,
  `correlation_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `break_glass_requests_facility_status_idx` ON `break_glass_requests` (`facility_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `break_glass_requests_target_idx` ON `break_glass_requests` (`facility_id`,`target_type`,`target_id`,`status`);
--> statement-breakpoint
INSERT OR IGNORE INTO permissions (id, permission_key, description) VALUES
  ('perm-break-glass-request', 'access.break_glass.request', 'Request controlled emergency access to a sensitive facility record.'),
  ('perm-break-glass-approve', 'access.break_glass.approve', 'Approve, deny, or revoke controlled emergency access.');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id FROM roles, permissions
WHERE (roles.name IN ('Scheduling Officer', 'Verification Officer', 'Monitoring Officer', 'Supervisor') AND permissions.permission_key = 'access.break_glass.request')
   OR (roles.name = 'Supervisor' AND permissions.permission_key = 'access.break_glass.approve');
