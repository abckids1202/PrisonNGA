CREATE TABLE `visitor_waiting_room_checkins` (
  `id` text PRIMARY KEY NOT NULL,
  `appointment_id` text NOT NULL,
  `facility_id` text NOT NULL,
  `visitor_user_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `state` text NOT NULL,
  `version` integer NOT NULL,
  `correlation_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`visitor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_waiting_room_checkins_idempotency_idx` ON `visitor_waiting_room_checkins` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `visitor_waiting_room_checkins_appointment_idx` ON `visitor_waiting_room_checkins` (`appointment_id`, `created_at`);
