ALTER TABLE `break_glass_requests` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
--> statement-breakpoint
UPDATE `break_glass_requests`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `break_glass_requests`.`facility_id`)
WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `break_glass_requests_organization_idx` ON `break_glass_requests` (`organization_id`, `facility_id`, `status`, `created_at`);
