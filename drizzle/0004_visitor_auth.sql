CREATE TABLE `auth_challenges` (
  `id` text PRIMARY KEY NOT NULL,
  `channel` text NOT NULL,
  `destination` text NOT NULL,
  `destination_hash` text NOT NULL,
  `destination_masked` text NOT NULL,
  `code_hash` text NOT NULL,
  `purpose` text NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer DEFAULT 5 NOT NULL,
  `expires_at` text NOT NULL,
  `consumed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_challenges_destination_idx` ON `auth_challenges` (`destination_hash`,`created_at`);
--> statement-breakpoint
CREATE INDEX `auth_challenges_expires_idx` ON `auth_challenges` (`expires_at`);
