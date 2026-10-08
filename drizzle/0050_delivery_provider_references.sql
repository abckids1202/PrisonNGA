ALTER TABLE `notification_delivery_attempts` ADD COLUMN `provider_reference` text;
--> statement-breakpoint
ALTER TABLE `auth_challenge_delivery_attempts` ADD COLUMN `provider_reference` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notification_delivery_provider_reference_idx` ON `notification_delivery_attempts` (`provider_reference`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_challenge_delivery_provider_reference_idx` ON `auth_challenge_delivery_attempts` (`provider_reference`);
