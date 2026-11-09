ALTER TABLE `credit_accounts` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `credit_ledger_entries` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `credit_accounts`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `credit_accounts`.`facility_id`)
WHERE `organization_id` IS NULL;
UPDATE `credit_ledger_entries`
SET `organization_id` = (SELECT `organization_id` FROM `credit_accounts` WHERE `credit_accounts`.`id` = `credit_ledger_entries`.`credit_account_id`)
WHERE `organization_id` IS NULL;
CREATE INDEX `credit_accounts_organization_idx` ON `credit_accounts` (`organization_id`, `facility_id`, `user_id`);
CREATE INDEX `credit_ledger_organization_idx` ON `credit_ledger_entries` (`organization_id`, `credit_account_id`, `created_at`);
CREATE TRIGGER `credit_ledger_organization_fill`
AFTER INSERT ON `credit_ledger_entries`
WHEN NEW.organization_id IS NULL
BEGIN
  UPDATE `credit_ledger_entries`
  SET `organization_id` = (SELECT `organization_id` FROM `credit_accounts` WHERE `credit_accounts`.`id` = NEW.`credit_account_id`)
  WHERE `id` = NEW.`id`;
END;
