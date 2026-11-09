ALTER TABLE `waiting_room_sessions` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `waiting_room_sessions`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `waiting_room_sessions`.`facility_id`)
WHERE `organization_id` IS NULL;
CREATE INDEX `waiting_room_sessions_organization_state_idx` ON `waiting_room_sessions` (`organization_id`, `facility_id`, `state`);
