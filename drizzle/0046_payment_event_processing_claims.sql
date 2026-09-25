ALTER TABLE `payment_provider_events` ADD `processing_started_at` text;
--> statement-breakpoint
CREATE INDEX `payment_provider_events_processing_idx` ON `payment_provider_events` (`status`, `processing_started_at`);
