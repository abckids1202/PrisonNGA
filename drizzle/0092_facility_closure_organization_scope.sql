ALTER TABLE `facility_closures` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);

UPDATE `facility_closures`
SET `organization_id` = (
  SELECT `organization_id` FROM `facilities`
  WHERE `facilities`.`id` = `facility_closures`.`facility_id`
)
WHERE `organization_id` IS NULL;

CREATE INDEX `facility_closures_organization_idx`
  ON `facility_closures` (`organization_id`, `facility_id`, `status`, `starts_at`, `ends_at`);

CREATE TRIGGER `facility_closures_organization_guard`
BEFORE INSERT ON `facility_closures`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `facilities`
    WHERE `facilities`.`id` = NEW.`facility_id`
      AND `facilities`.`organization_id` = NEW.`organization_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'facility closure organization scope mismatch');
END;

CREATE TRIGGER `facility_closures_organization_fill`
AFTER INSERT ON `facility_closures`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `facility_closures`
  SET `organization_id` = (
    SELECT `organization_id` FROM `facilities`
    WHERE `facilities`.`id` = NEW.`facility_id`
  )
  WHERE `id` = NEW.`id`;
END;

CREATE TRIGGER `facility_closures_organization_update_guard`
BEFORE UPDATE OF `facility_id`, `organization_id` ON `facility_closures`
WHEN NOT EXISTS (
  SELECT 1 FROM `facilities`
  WHERE `facilities`.`id` = NEW.`facility_id`
    AND `facilities`.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'facility closure organization scope mismatch');
END;
