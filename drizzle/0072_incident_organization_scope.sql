ALTER TABLE `incidents` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `incidents` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `incidents`.`facility_id`) WHERE `organization_id` IS NULL;
CREATE INDEX `incidents_organization_idx` ON `incidents` (`organization_id`, `facility_id`, `status`, `created_at`);
ALTER TABLE `incident_events` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `incident_events` SET `organization_id` = (SELECT `organization_id` FROM `incidents` WHERE `incidents`.`id` = `incident_events`.`incident_id`) WHERE `organization_id` IS NULL;
CREATE INDEX `incident_events_organization_idx` ON `incident_events` (`organization_id`, `incident_id`, `created_at`);
