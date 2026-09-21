CREATE TABLE `notifications` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text,
  `user_id` text NOT NULL,
  `channel` text DEFAULT 'IN_APP' NOT NULL,
  `template` text NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `payload` text DEFAULT '{}' NOT NULL,
  `status` text DEFAULT 'QUEUED' NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `available_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `delivered_at` text,
  `read_at` text,
  `last_error` text,
  `idempotency_key` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_idempotency_idx` ON `notifications` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `notifications_user_status_idx` ON `notifications` (`user_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `notifications_facility_idx` ON `notifications` (`facility_id`,`created_at`);
