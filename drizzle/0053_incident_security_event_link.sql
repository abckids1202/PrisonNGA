ALTER TABLE `incidents` ADD COLUMN `source_security_event_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `incidents_source_security_event_idx` ON `incidents` (`source_security_event_id`) WHERE `source_security_event_id` IS NOT NULL;
