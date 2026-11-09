ALTER TABLE `resources` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `resource_reservations` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `kiosk_credentials` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `resources`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `resources`.`facility_id`)
WHERE `organization_id` IS NULL;
UPDATE `resource_reservations`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `resource_reservations`.`facility_id`)
WHERE `organization_id` IS NULL;
UPDATE `kiosk_credentials`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `kiosk_credentials`.`facility_id`)
WHERE `organization_id` IS NULL;
CREATE INDEX `resources_organization_type_idx` ON `resources` (`organization_id`, `facility_id`, `resource_type`, `status`);
CREATE INDEX `resource_reservations_organization_idx` ON `resource_reservations` (`organization_id`, `facility_id`, `appointment_id`);
CREATE INDEX `kiosk_credentials_organization_status_idx` ON `kiosk_credentials` (`organization_id`, `facility_id`, `status`);
