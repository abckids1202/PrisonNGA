CREATE TABLE `waiting_room_sessions` (
  `appointment_id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL,
  `state` text DEFAULT 'NOT_ARRIVED' NOT NULL,
  `visitor_presence` text DEFAULT 'absent' NOT NULL,
  `prisoner_presence` text DEFAULT 'waiting' NOT NULL,
  `identity_state` text DEFAULT 'pending' NOT NULL,
  `camera_state` text DEFAULT 'pending' NOT NULL,
  `microphone_state` text DEFAULT 'pending' NOT NULL,
  `network_state` text DEFAULT 'pending' NOT NULL,
  `room_state` text DEFAULT 'pass' NOT NULL,
  `kiosk_state` text DEFAULT 'pending' NOT NULL,
  `restriction_state` text DEFAULT 'pass' NOT NULL,
  `staff_notes` text,
  `version` integer DEFAULT 1 NOT NULL,
  `last_checked_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `waiting_room_sessions_facility_state_idx` ON `waiting_room_sessions` (`facility_id`,`state`);
--> statement-breakpoint
CREATE INDEX `waiting_room_sessions_facility_appointment_idx` ON `waiting_room_sessions` (`facility_id`,`appointment_id`);
