ALTER TABLE `audit_events` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `audit_events` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `audit_events`.`facility_id`) WHERE `organization_id` IS NULL AND `facility_id` IS NOT NULL;
CREATE INDEX `audit_events_organization_idx` ON `audit_events` (`organization_id`, `facility_id`, `created_at`);
ALTER TABLE `outbox_events` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `outbox_events` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `outbox_events`.`facility_id`) WHERE `organization_id` IS NULL AND `facility_id` IS NOT NULL;
CREATE INDEX `outbox_events_organization_idx` ON `outbox_events` (`organization_id`, `facility_id`, `status`, `available_at`);
