CREATE TABLE `audit_export_manifests` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL,
  `requested_by` text NOT NULL,
  `sha256` text NOT NULL,
  `row_count` integer NOT NULL,
  `from_at` text,
  `to_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_export_manifests_sha256_idx` ON `audit_export_manifests` (`facility_id`,`sha256`);
--> statement-breakpoint
CREATE INDEX `audit_export_manifests_created_idx` ON `audit_export_manifests` (`facility_id`,`created_at`);
