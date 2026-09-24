ALTER TABLE `outbox_events` ADD COLUMN `processing_started_at` text;
--> statement-breakpoint
CREATE INDEX `outbox_events_processing_started_idx` ON `outbox_events` (`status`,`processing_started_at`);
