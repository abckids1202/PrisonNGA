ALTER TABLE `idempotency_records` ADD `processing_started_at` text;
--> statement-breakpoint
CREATE INDEX `idempotency_records_processing_idx` ON `idempotency_records` (`status`, `processing_started_at`);
