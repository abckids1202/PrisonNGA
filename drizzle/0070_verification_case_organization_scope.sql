ALTER TABLE `verification_cases` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
--> statement-breakpoint
UPDATE `verification_cases`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `verification_cases`.`facility_id`)
WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `verification_cases_organization_idx` ON `verification_cases` (`organization_id`, `facility_id`, `status`);
