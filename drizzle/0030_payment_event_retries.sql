ALTER TABLE `payment_provider_events` ADD `attempt_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `payment_provider_events` ADD `available_at` text NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE `payment_provider_events` ADD `last_error` text;
--> statement-breakpoint
CREATE INDEX `payment_provider_events_retry_idx` ON `payment_provider_events` (`status`, `available_at`, `created_at`);
