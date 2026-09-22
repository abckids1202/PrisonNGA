CREATE TABLE `kiosk_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`credential_hash` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CHECK (`status` IN ('ACTIVE', 'REVOKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kiosk_credentials_active_resource_idx` ON `kiosk_credentials` (`resource_id`) WHERE `status` = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX `kiosk_credentials_facility_status_idx` ON `kiosk_credentials` (`facility_id`, `status`);
