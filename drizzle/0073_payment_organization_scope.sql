ALTER TABLE `payment_intents` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `payment_intents` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `payment_intents`.`facility_id`) WHERE `organization_id` IS NULL;
CREATE INDEX `payment_intents_organization_idx` ON `payment_intents` (`organization_id`, `facility_id`, `status`, `created_at`);
ALTER TABLE `payment_refund_requests` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
UPDATE `payment_refund_requests` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `payment_refund_requests`.`facility_id`) WHERE `organization_id` IS NULL;
CREATE INDEX `payment_refund_requests_organization_idx` ON `payment_refund_requests` (`organization_id`, `facility_id`, `status`, `created_at`);
