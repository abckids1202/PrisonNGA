CREATE TABLE `visit_session_participants` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `facility_id` text NOT NULL,
  `identity` text NOT NULL,
  `participant_role` text NOT NULL,
  `participant_sid` text,
  `status` text NOT NULL,
  `first_seen_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  `disconnected_at` text,
  `metadata` text DEFAULT '{}' NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `visit_sessions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visit_session_participants_identity_idx` ON `visit_session_participants` (`session_id`, `identity`);
--> statement-breakpoint
CREATE INDEX `visit_session_participants_facility_status_idx` ON `visit_session_participants` (`facility_id`, `status`, `last_seen_at`);

