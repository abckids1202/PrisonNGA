-- Prevent parent-derived financial and incident history from crossing an
-- organization boundary. NULL organization values remain fillable from the
-- authoritative parent for compatibility with older writers.
CREATE TRIGGER `credit_ledger_entries_organization_guard`
BEFORE INSERT ON `credit_ledger_entries`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `credit_accounts` ca
    WHERE ca.`id` = NEW.`credit_account_id`
      AND ca.`organization_id` = NEW.`organization_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'credit ledger organization scope mismatch');
END;

CREATE TRIGGER `incident_events_organization_guard`
BEFORE INSERT ON `incident_events`
WHEN NEW.`organization_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `incidents` i
    WHERE i.`id` = NEW.`incident_id`
      AND i.`organization_id` = NEW.`organization_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'incident event organization scope mismatch');
END;

CREATE TRIGGER `incident_events_organization_fill`
AFTER INSERT ON `incident_events`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `incident_events`
  SET `organization_id` = (
    SELECT `organization_id`
    FROM `incidents`
    WHERE `incidents`.`id` = NEW.`incident_id`
  )
  WHERE `id` = NEW.`id`;
END;
