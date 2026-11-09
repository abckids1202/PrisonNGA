ALTER TABLE `prisoners` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `visitor_relationships` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `prisoners`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `prisoners`.`facility_id`)
WHERE `organization_id` IS NULL;
UPDATE `visitor_relationships`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `visitor_relationships`.`facility_id`)
WHERE `organization_id` IS NULL;
CREATE INDEX `prisoners_organization_status_idx` ON `prisoners` (`organization_id`, `facility_id`, `status`, `visitation_status`);
CREATE INDEX `visitor_relationships_organization_status_idx` ON `visitor_relationships` (`organization_id`, `facility_id`, `status`);
