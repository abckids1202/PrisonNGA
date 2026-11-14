ALTER TABLE `kiosk_device_check_attempts` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);

UPDATE `kiosk_device_check_attempts`
SET `organization_id` = (
  SELECT `organization_id` FROM `facilities`
  WHERE `facilities`.`id` = `kiosk_device_check_attempts`.`facility_id`
)
WHERE `organization_id` IS NULL;

CREATE INDEX `kiosk_device_check_organization_idx`
  ON `kiosk_device_check_attempts` (`organization_id`, `facility_id`, `appointment_id`, `created_at`);

CREATE TRIGGER `kiosk_device_check_organization_guard`
BEFORE INSERT ON `kiosk_device_check_attempts`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `facilities`
    WHERE `facilities`.`id` = NEW.`facility_id`
      AND `facilities`.`organization_id` = NEW.`organization_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'kiosk device check organization scope mismatch');
END;

CREATE TRIGGER `kiosk_device_check_organization_fill`
AFTER INSERT ON `kiosk_device_check_attempts`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `kiosk_device_check_attempts`
  SET `organization_id` = (
    SELECT `organization_id` FROM `facilities`
    WHERE `facilities`.`id` = NEW.`facility_id`
  )
  WHERE `id` = NEW.`id`;
END;

CREATE TRIGGER `kiosk_device_check_organization_update_guard`
BEFORE UPDATE OF `facility_id`, `organization_id` ON `kiosk_device_check_attempts`
WHEN NOT EXISTS (
  SELECT 1 FROM `facilities`
  WHERE `facilities`.`id` = NEW.`facility_id`
    AND `facilities`.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'kiosk device check organization scope mismatch');
END;
