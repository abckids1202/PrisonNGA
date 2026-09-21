CREATE TABLE `visit_policies` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL REFERENCES facilities(id),
  `min_duration_minutes` integer DEFAULT 15 NOT NULL,
  `max_duration_minutes` integer DEFAULT 30 NOT NULL,
  `min_advance_minutes` integer DEFAULT 60 NOT NULL,
  `max_advance_days` integer DEFAULT 30 NOT NULL,
  `daily_start_time` text DEFAULT '08:00' NOT NULL,
  `daily_end_time` text DEFAULT '17:00' NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visit_policies_facility_idx` ON `visit_policies` (`facility_id`);
