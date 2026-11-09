ALTER TABLE `appointment_status_events` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `visitor_waiting_room_checkins` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `visitor_device_check_attempts` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `visit_session_events` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `visit_session_participants` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `recording_consents` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);

UPDATE `appointment_status_events`
SET `organization_id` = (SELECT `organization_id` FROM `appointments` WHERE `appointments`.`id` = `appointment_status_events`.`appointment_id`)
WHERE `organization_id` IS NULL;
UPDATE `visitor_waiting_room_checkins`
SET `organization_id` = (SELECT `organization_id` FROM `appointments` WHERE `appointments`.`id` = `visitor_waiting_room_checkins`.`appointment_id`)
WHERE `organization_id` IS NULL;
UPDATE `visitor_device_check_attempts`
SET `organization_id` = (SELECT `organization_id` FROM `appointments` WHERE `appointments`.`id` = `visitor_device_check_attempts`.`appointment_id`)
WHERE `organization_id` IS NULL;
UPDATE `visit_session_events`
SET `organization_id` = (SELECT `organization_id` FROM `visit_sessions` WHERE `visit_sessions`.`id` = `visit_session_events`.`session_id`)
WHERE `organization_id` IS NULL;
UPDATE `visit_session_participants`
SET `organization_id` = (SELECT `organization_id` FROM `visit_sessions` WHERE `visit_sessions`.`id` = `visit_session_participants`.`session_id`)
WHERE `organization_id` IS NULL;
UPDATE `recording_consents`
SET `organization_id` = (SELECT `organization_id` FROM `visit_sessions` WHERE `visit_sessions`.`id` = `recording_consents`.`session_id`)
WHERE `organization_id` IS NULL;

CREATE INDEX `appointment_status_events_organization_idx` ON `appointment_status_events` (`organization_id`, `appointment_id`, `created_at`);
CREATE INDEX `visitor_waiting_room_checkins_organization_idx` ON `visitor_waiting_room_checkins` (`organization_id`, `appointment_id`, `created_at`);
CREATE INDEX `visitor_device_check_organization_idx` ON `visitor_device_check_attempts` (`organization_id`, `facility_id`, `created_at`);
CREATE INDEX `visit_session_events_organization_idx` ON `visit_session_events` (`organization_id`, `session_id`, `created_at`);
CREATE INDEX `visit_session_participants_organization_status_idx` ON `visit_session_participants` (`organization_id`, `facility_id`, `status`, `last_seen_at`);
CREATE INDEX `recording_consents_organization_idx` ON `recording_consents` (`organization_id`, `facility_id`, `decided_at`);

CREATE TRIGGER `appointment_status_events_organization_fill`
AFTER INSERT ON `appointment_status_events`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `appointment_status_events`
  SET `organization_id` = (SELECT `organization_id` FROM `appointments` WHERE `appointments`.`id` = NEW.`appointment_id`)
  WHERE `id` = NEW.`id`;
END;

CREATE TRIGGER `visitor_waiting_room_checkins_organization_fill`
AFTER INSERT ON `visitor_waiting_room_checkins`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `visitor_waiting_room_checkins`
  SET `organization_id` = (SELECT `organization_id` FROM `appointments` WHERE `appointments`.`id` = NEW.`appointment_id`)
  WHERE `id` = NEW.`id`;
END;

CREATE TRIGGER `visitor_device_check_organization_fill`
AFTER INSERT ON `visitor_device_check_attempts`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `visitor_device_check_attempts`
  SET `organization_id` = (SELECT `organization_id` FROM `appointments` WHERE `appointments`.`id` = NEW.`appointment_id`)
  WHERE `id` = NEW.`id`;
END;

CREATE TRIGGER `visit_session_events_organization_fill`
AFTER INSERT ON `visit_session_events`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `visit_session_events`
  SET `organization_id` = (SELECT `organization_id` FROM `visit_sessions` WHERE `visit_sessions`.`id` = NEW.`session_id`)
  WHERE `id` = NEW.`id`;
END;

CREATE TRIGGER `visit_session_participants_organization_fill`
AFTER INSERT ON `visit_session_participants`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `visit_session_participants`
  SET `organization_id` = (SELECT `organization_id` FROM `visit_sessions` WHERE `visit_sessions`.`id` = NEW.`session_id`)
  WHERE `id` = NEW.`id`;
END;

CREATE TRIGGER `recording_consents_organization_fill`
AFTER INSERT ON `recording_consents`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `recording_consents`
  SET `organization_id` = (SELECT `organization_id` FROM `visit_sessions` WHERE `visit_sessions`.`id` = NEW.`session_id`)
  WHERE `id` = NEW.`id`;
END;
