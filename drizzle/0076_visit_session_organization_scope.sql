ALTER TABLE `visit_sessions` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `visit_sessions` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `visit_sessions`.`facility_id`) WHERE `organization_id` IS NULL;
CREATE INDEX `visit_sessions_organization_idx` ON `visit_sessions` (`organization_id`, `facility_id`, `status`);
