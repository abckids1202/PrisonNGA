ALTER TABLE `notification_delivery_attempts` ADD COLUMN `provider_status` text;
--> statement-breakpoint
ALTER TABLE `notification_delivery_attempts` ADD COLUMN `provider_error` text;
--> statement-breakpoint
ALTER TABLE `notification_delivery_attempts` ADD COLUMN `status_updated_at` text;
--> statement-breakpoint
ALTER TABLE `auth_challenge_delivery_attempts` ADD COLUMN `provider_status` text;
--> statement-breakpoint
ALTER TABLE `auth_challenge_delivery_attempts` ADD COLUMN `provider_error` text;
--> statement-breakpoint
ALTER TABLE `auth_challenge_delivery_attempts` ADD COLUMN `status_updated_at` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_provider_events` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `event_key` text NOT NULL,
  `provider_reference` text NOT NULL,
  `status` text NOT NULL,
  `payload` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `notification_provider_events_key_idx` ON `notification_provider_events` (`provider`, `event_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notification_provider_events_reference_idx` ON `notification_provider_events` (`provider`, `provider_reference`, `created_at`);
