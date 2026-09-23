CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
  `id` text PRIMARY KEY NOT NULL,
  `outbox_event_id` text NOT NULL,
  `notification_id` text NOT NULL,
  `channel` text NOT NULL,
  `attempt_number` integer NOT NULL,
  `status` text NOT NULL,
  `error_message` text,
  `started_at` text NOT NULL,
  `finished_at` text,
  FOREIGN KEY (`outbox_event_id`) REFERENCES `outbox_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS notification_delivery_attempt_key_idx ON notification_delivery_attempts (outbox_event_id, channel, attempt_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notification_delivery_attempt_event_idx ON notification_delivery_attempts (outbox_event_id, started_at);
