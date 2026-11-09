-- Recording playback is a high-sensitivity boundary. Keep access evidence
-- aligned with the recording and facility even if a future writer omits the
-- denormalized organization value.
CREATE TRIGGER `recording_access_events_organization_guard`
BEFORE INSERT ON `recording_access_events`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `recordings` r
    INNER JOIN `facilities` f ON f.`id` = r.`facility_id`
    WHERE r.`id` = NEW.`recording_id`
      AND r.`facility_id` = NEW.`facility_id`
      AND r.`organization_id` = NEW.`organization_id`
      AND f.`organization_id` = NEW.`organization_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'recording access organization scope mismatch');
END;

CREATE TRIGGER `recording_access_events_organization_fill`
AFTER INSERT ON `recording_access_events`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `recording_access_events`
  SET `organization_id` = (
    SELECT `organization_id`
    FROM `recordings`
    WHERE `recordings`.`id` = NEW.`recording_id`
      AND `recordings`.`facility_id` = NEW.`facility_id`
  )
  WHERE `id` = NEW.`id`;
END;
