CREATE TABLE `organizations` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `slug` text NOT NULL,
  `status` text DEFAULT 'ACTIVE' NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_idx` ON `organizations` (`slug`);
--> statement-breakpoint
CREATE INDEX `organizations_status_idx` ON `organizations` (`status`);
--> statement-breakpoint
ALTER TABLE `facilities` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
--> statement-breakpoint
CREATE INDEX `facilities_organization_idx` ON `facilities` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `facilities_state_idx` ON `facilities` (`current_state`);
--> statement-breakpoint
INSERT OR IGNORE INTO `organizations` (`id`, `name`, `slug`, `status`, `version`, `created_at`, `updated_at`)
SELECT 'org-legacy', 'SecureVisit Legacy Organization', 'securevisit-legacy', 'ACTIVE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM `facilities`);
--> statement-breakpoint
UPDATE `facilities` SET `organization_id` = 'org-legacy' WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE TABLE `organization_memberships` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`),
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `facility_id` text REFERENCES `facilities`(`id`),
  `role` text NOT NULL,
  `status` text DEFAULT 'ACTIVE' NOT NULL,
  `assigned_by` text REFERENCES `users`(`id`),
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_memberships_scope_idx` ON `organization_memberships` (`organization_id`, `user_id`, `facility_id`, `role`);
--> statement-breakpoint
CREATE INDEX `organization_memberships_user_idx` ON `organization_memberships` (`user_id`, `status`);
--> statement-breakpoint
CREATE INDEX `organization_memberships_facility_idx` ON `organization_memberships` (`facility_id`, `status`);
--> statement-breakpoint
ALTER TABLE `visit_policies` ADD COLUMN `recording_policy` text DEFAULT 'OFF' NOT NULL;
--> statement-breakpoint
ALTER TABLE `visit_policies` ADD COLUMN `recording_retention_days` integer;
--> statement-breakpoint
CREATE TABLE `recording_consents` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `visit_sessions`(`id`),
  `facility_id` text NOT NULL REFERENCES `facilities`(`id`),
  `participant_user_id` text NOT NULL REFERENCES `users`(`id`),
  `participant_role` text NOT NULL,
  `decision` text NOT NULL,
  `policy_version` integer,
  `notice_version` text NOT NULL,
  `decided_at` text NOT NULL,
  `correlation_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_consents_session_participant_idx` ON `recording_consents` (`session_id`, `participant_user_id`);
--> statement-breakpoint
CREATE INDEX `recording_consents_facility_idx` ON `recording_consents` (`facility_id`, `decided_at`);
--> statement-breakpoint
CREATE TABLE `recordings` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text REFERENCES `organizations`(`id`),
  `facility_id` text NOT NULL REFERENCES `facilities`(`id`),
  `session_id` text NOT NULL REFERENCES `visit_sessions`(`id`),
  `provider` text NOT NULL,
  `provider_reference` text,
  `storage_key` text,
  `encryption_key_reference` text,
  `status` text DEFAULT 'PENDING' NOT NULL,
  `content_type` text,
  `byte_size` integer,
  `sha256` text,
  `retention_until` text,
  `legal_hold` integer DEFAULT false NOT NULL,
  `failure_reason` text,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_session_idx` ON `recordings` (`session_id`);
--> statement-breakpoint
CREATE INDEX `recordings_facility_status_idx` ON `recordings` (`facility_id`, `status`);
--> statement-breakpoint
CREATE INDEX `recordings_retention_idx` ON `recordings` (`facility_id`, `retention_until`, `legal_hold`);
--> statement-breakpoint
CREATE TABLE `recording_access_events` (
  `id` text PRIMARY KEY NOT NULL,
  `recording_id` text NOT NULL REFERENCES `recordings`(`id`),
  `organization_id` text REFERENCES `organizations`(`id`),
  `facility_id` text NOT NULL REFERENCES `facilities`(`id`),
  `actor_user_id` text NOT NULL REFERENCES `users`(`id`),
  `access_type` text NOT NULL,
  `break_glass_request_id` text,
  `reason` text NOT NULL,
  `correlation_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recording_access_events_recording_idx` ON `recording_access_events` (`recording_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `recording_access_events_facility_idx` ON `recording_access_events` (`facility_id`, `created_at`);
