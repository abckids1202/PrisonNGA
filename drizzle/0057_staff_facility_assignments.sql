CREATE TABLE `staff_facility_assignments` (
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `facility_id` text NOT NULL REFERENCES `facilities`(`id`),
  `employee_reference` text NOT NULL,
  `job_title` text NOT NULL,
  `department` text,
  `status` text DEFAULT 'ACTIVE' NOT NULL,
  `assigned_by` text REFERENCES `users`(`id`),
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`user_id`, `facility_id`)
);
--> statement-breakpoint
CREATE INDEX `staff_facility_assignments_facility_idx` ON `staff_facility_assignments` (`facility_id`, `status`);
--> statement-breakpoint
CREATE INDEX `staff_facility_assignments_user_idx` ON `staff_facility_assignments` (`user_id`, `status`);
--> statement-breakpoint
INSERT OR IGNORE INTO `staff_facility_assignments` (`user_id`, `facility_id`, `employee_reference`, `job_title`, `department`, `status`, `assigned_by`, `version`, `created_at`, `updated_at`)
SELECT `user_id`, `facility_id`, `employee_reference`, `job_title`, `department`, 'ACTIVE', NULL, 1, `created_at`, `updated_at`
FROM `staff_profiles`;
