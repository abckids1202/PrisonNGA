ALTER TABLE `incidents` ADD COLUMN `last_transition_id` text;
--> statement-breakpoint
CREATE INDEX `incidents_transition_idx` ON `incidents` (`id`, `last_transition_id`);
