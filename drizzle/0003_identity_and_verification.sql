CREATE TABLE `prisoners` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL,
  `prisoner_number` text NOT NULL,
  `display_name` text NOT NULL,
  `housing_unit` text,
  `status` text DEFAULT 'ACTIVE' NOT NULL,
  `visitation_status` text DEFAULT 'APPROVED' NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prisoners_facility_number_idx` ON `prisoners` (`facility_id`,`prisoner_number`);
--> statement-breakpoint
CREATE INDEX `prisoners_facility_status_idx` ON `prisoners` (`facility_id`,`status`,`visitation_status`);
--> statement-breakpoint
CREATE TABLE `visitor_profiles` (
  `user_id` text PRIMARY KEY NOT NULL,
  `legal_name` text NOT NULL,
  `preferred_name` text,
  `phone` text,
  `phone_verified_at` text,
  `profile_status` text DEFAULT 'INCOMPLETE' NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `visitor_relationships` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL,
  `visitor_user_id` text NOT NULL,
  `prisoner_id` text NOT NULL,
  `relationship_type` text NOT NULL,
  `status` text DEFAULT 'PENDING' NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`visitor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`prisoner_id`) REFERENCES `prisoners`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_relationships_pair_idx` ON `visitor_relationships` (`visitor_user_id`,`prisoner_id`);
--> statement-breakpoint
CREATE INDEX `visitor_relationships_facility_status_idx` ON `visitor_relationships` (`facility_id`,`status`);
--> statement-breakpoint
CREATE TABLE `verification_cases` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL,
  `relationship_id` text NOT NULL,
  `status` text DEFAULT 'PENDING' NOT NULL,
  `evidence_required` integer DEFAULT true NOT NULL,
  `submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`relationship_id`) REFERENCES `visitor_relationships`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_cases_relationship_idx` ON `verification_cases` (`relationship_id`);
--> statement-breakpoint
CREATE INDEX `verification_cases_facility_status_idx` ON `verification_cases` (`facility_id`,`status`);
