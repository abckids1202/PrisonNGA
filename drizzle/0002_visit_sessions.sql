CREATE TABLE `visit_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `appointment_id` text NOT NULL,
  `facility_id` text NOT NULL,
  `provider` text DEFAULT 'livekit' NOT NULL,
  `provider_room_name` text NOT NULL,
  `provider_room_sid` text,
  `status` text DEFAULT 'PREPARING' NOT NULL,
  `authorized_start_at` text NOT NULL,
  `authorized_end_at` text NOT NULL,
  `actual_started_at` text,
  `actual_ended_at` text,
  `created_by` text,
  `recording_policy` text DEFAULT 'OFF' NOT NULL,
  `recording_status` text DEFAULT 'NOT_RECORDED' NOT NULL,
  `termination_reason` text,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visit_sessions_appointment_idx` ON `visit_sessions` (`appointment_id`);
--> statement-breakpoint
CREATE INDEX `visit_sessions_facility_status_idx` ON `visit_sessions` (`facility_id`,`status`);
--> statement-breakpoint
CREATE TABLE `visit_session_events` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `event_type` text NOT NULL,
  `source` text NOT NULL,
  `participant_role` text,
  `metadata` text DEFAULT '{}' NOT NULL,
  `correlation_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `visit_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `visit_session_events_session_idx` ON `visit_session_events` (`session_id`,`created_at`);
