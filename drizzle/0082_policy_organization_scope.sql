ALTER TABLE `visit_policies` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `visit_policy_history` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `appointment_types` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `visit_policies` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `visit_policies`.`facility_id`) WHERE `organization_id` IS NULL;
UPDATE `visit_policy_history` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `visit_policy_history`.`facility_id`) WHERE `organization_id` IS NULL;
UPDATE `appointment_types` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `appointment_types`.`facility_id`) WHERE `organization_id` IS NULL;
CREATE INDEX `visit_policies_organization_idx` ON `visit_policies` (`organization_id`, `facility_id`);
CREATE INDEX `visit_policy_history_organization_idx` ON `visit_policy_history` (`organization_id`, `facility_id`, `version`);
CREATE INDEX `appointment_types_organization_status_idx` ON `appointment_types` (`organization_id`, `facility_id`, `status`);
