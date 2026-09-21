CREATE TABLE `resources` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL,
  `resource_type` text NOT NULL,
  `display_name` text NOT NULL,
  `status` text DEFAULT 'AVAILABLE' NOT NULL,
  `room_id` text,
  `health_state` text DEFAULT 'UNKNOWN' NOT NULL,
  `last_heartbeat_at` text,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `resources_facility_type_idx` ON `resources` (`facility_id`,`resource_type`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `resources_facility_name_idx` ON `resources` (`facility_id`,`display_name`);
