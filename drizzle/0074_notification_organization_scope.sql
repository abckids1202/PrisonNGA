ALTER TABLE `notifications` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `notifications` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `notifications`.`facility_id`) WHERE `organization_id` IS NULL AND `facility_id` IS NOT NULL;
CREATE INDEX `notifications_organization_idx` ON `notifications` (`organization_id`, `facility_id`, `status`, `created_at`);
