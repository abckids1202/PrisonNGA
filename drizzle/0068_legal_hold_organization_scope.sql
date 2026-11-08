ALTER TABLE `legal_holds` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
--> statement-breakpoint
UPDATE `legal_holds`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `legal_holds`.`facility_id`)
WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `legal_holds_organization_idx` ON `legal_holds` (`organization_id`, `facility_id`, `status`);
