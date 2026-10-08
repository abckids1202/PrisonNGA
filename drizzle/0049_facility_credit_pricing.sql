ALTER TABLE `visit_policies` ADD COLUMN `credit_price_minor` integer;
--> statement-breakpoint
ALTER TABLE `visit_policies` ADD COLUMN `credit_currency` text NOT NULL DEFAULT 'IDR';
--> statement-breakpoint
CREATE INDEX `visit_policies_credit_price_idx` ON `visit_policies` (`facility_id`, `credit_price_minor`, `credit_currency`);
