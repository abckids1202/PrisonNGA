CREATE TABLE `organization_role_assignments` (
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`),
  `role_id` text NOT NULL REFERENCES `roles`(`id`),
  `status` text DEFAULT 'ACTIVE' NOT NULL,
  `assigned_by` text REFERENCES `users`(`id`),
  `version` integer DEFAULT 1 NOT NULL,
  `assigned_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`user_id`, `organization_id`, `role_id`)
);
--> statement-breakpoint
CREATE INDEX `organization_role_assignments_organization_idx` ON `organization_role_assignments` (`organization_id`, `status`);
--> statement-breakpoint
CREATE INDEX `organization_role_assignments_user_idx` ON `organization_role_assignments` (`user_id`, `status`);
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_role_assignments` (`user_id`, `organization_id`, `role_id`, `status`, `assigned_by`, `version`, `assigned_at`, `created_at`, `updated_at`)
SELECT DISTINCT ur.user_id, f.organization_id, ur.role_id, 'ACTIVE',
  CASE WHEN EXISTS (SELECT 1 FROM users assigned_user WHERE assigned_user.id = ur.assigned_by) THEN ur.assigned_by ELSE NULL END,
  1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM `user_roles` ur
INNER JOIN `facilities` f ON f.id = ur.facility_id AND f.organization_id IS NOT NULL
INNER JOIN `role_permissions` rp ON rp.role_id = ur.role_id
INNER JOIN `permissions` p ON p.id = rp.permission_id AND p.permission_key = 'organization.manage';
