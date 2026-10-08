ALTER TABLE `notification_delivery_attempts` ADD COLUMN `provider` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notification_delivery_provider_status_idx` ON `notification_delivery_attempts` (`provider`, `provider_reference`, `status`);
