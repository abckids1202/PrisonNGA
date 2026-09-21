CREATE TABLE `payment_intents` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL,
  `user_id` text NOT NULL,
  `provider` text NOT NULL,
  `credit_quantity` integer NOT NULL,
  `amount_minor` integer NOT NULL,
  `currency` text DEFAULT 'IDR' NOT NULL,
  `status` text DEFAULT 'PENDING' NOT NULL,
  `provider_reference` text,
  `checkout_url` text,
  `idempotency_key` text NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_intents_idempotency_idx` ON `payment_intents` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `payment_intents_user_status_idx` ON `payment_intents` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `payment_intents_facility_status_idx` ON `payment_intents` (`facility_id`,`status`);
--> statement-breakpoint
CREATE TABLE `payment_provider_events` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `event_key` text NOT NULL,
  `event_type` text NOT NULL,
  `payload` text DEFAULT '{}' NOT NULL,
  `status` text DEFAULT 'RECEIVED' NOT NULL,
  `processed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_provider_events_key_idx` ON `payment_provider_events` (`provider`,`event_key`);
--> statement-breakpoint
CREATE INDEX `payment_provider_events_created_idx` ON `payment_provider_events` (`created_at`);
