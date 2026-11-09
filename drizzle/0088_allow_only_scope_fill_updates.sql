-- The legacy organization-fill triggers perform one internal update after an
-- insert. Permit only that exact null-to-parent-scope transition; all other
-- updates remain forbidden for append-only history.
DROP TRIGGER IF EXISTS `credit_ledger_entries_immutable_update`;
CREATE TRIGGER `credit_ledger_entries_immutable_update`
BEFORE UPDATE ON `credit_ledger_entries`
WHEN NOT (
  OLD.`organization_id` IS NULL
  AND NEW.`organization_id` = (SELECT `organization_id` FROM `credit_accounts` WHERE `id` = OLD.`credit_account_id`)
  AND NEW.`id` = OLD.`id`
  AND NEW.`credit_account_id` = OLD.`credit_account_id`
  AND NEW.`appointment_id` IS OLD.`appointment_id`
  AND NEW.`entry_type` = OLD.`entry_type`
  AND NEW.`amount` = OLD.`amount`
  AND NEW.`idempotency_key` = OLD.`idempotency_key`
  AND NEW.`reason` IS OLD.`reason`
  AND NEW.`created_by` IS OLD.`created_by`
  AND NEW.`created_at` = OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'credit ledger entries are append-only');
END;

DROP TRIGGER IF EXISTS `incident_events_immutable_update`;
CREATE TRIGGER `incident_events_immutable_update`
BEFORE UPDATE ON `incident_events`
WHEN NOT (
  OLD.`organization_id` IS NULL
  AND NEW.`organization_id` = (SELECT `organization_id` FROM `incidents` WHERE `id` = OLD.`incident_id`)
  AND NEW.`id` = OLD.`id`
  AND NEW.`incident_id` = OLD.`incident_id`
  AND NEW.`event_type` = OLD.`event_type`
  AND NEW.`actor_user_id` = OLD.`actor_user_id`
  AND NEW.`details` = OLD.`details`
  AND NEW.`correlation_id` = OLD.`correlation_id`
  AND NEW.`created_at` = OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'incident events are append-only');
END;

DROP TRIGGER IF EXISTS `recording_access_events_immutable_update`;
CREATE TRIGGER `recording_access_events_immutable_update`
BEFORE UPDATE ON `recording_access_events`
WHEN NOT (
  OLD.`organization_id` IS NULL
  AND NEW.`organization_id` = (SELECT `organization_id` FROM `recordings` WHERE `id` = OLD.`recording_id` AND `facility_id` = OLD.`facility_id`)
  AND NEW.`id` = OLD.`id`
  AND NEW.`recording_id` = OLD.`recording_id`
  AND NEW.`facility_id` = OLD.`facility_id`
  AND NEW.`actor_user_id` = OLD.`actor_user_id`
  AND NEW.`access_type` = OLD.`access_type`
  AND NEW.`break_glass_request_id` IS OLD.`break_glass_request_id`
  AND NEW.`reason` = OLD.`reason`
  AND NEW.`correlation_id` = OLD.`correlation_id`
  AND NEW.`created_at` = OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'recording access events are append-only');
END;
