CREATE TABLE `rate_limit_buckets` (
  `key_hash` text PRIMARY KEY NOT NULL,
  `window_started_at` integer NOT NULL,
  `request_count` integer DEFAULT 0 NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_buckets_updated_idx` ON `rate_limit_buckets` (`updated_at`);
