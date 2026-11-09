ALTER TABLE `appointments` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `appointments`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `appointments`.`facility_id`)
WHERE `organization_id` IS NULL;
CREATE INDEX `appointments_organization_status_idx` ON `appointments` (`organization_id`, `facility_id`, `status`);
