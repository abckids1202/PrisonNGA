ALTER TABLE `evidence_documents` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
--> statement-breakpoint
UPDATE `evidence_documents`
SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `evidence_documents`.`facility_id`)
WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `evidence_documents_organization_idx` ON `evidence_documents` (`organization_id`, `facility_id`, `status`);
