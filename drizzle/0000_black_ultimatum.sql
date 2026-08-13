CREATE TABLE `appointment_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor_user_id` text,
	`reason_code` text,
	`reason_text` text,
	`correlation_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointment_status_events_appointment_idx` ON `appointment_status_events` (`appointment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` text NOT NULL,
	`visitor_user_id` text NOT NULL,
	`prisoner_id` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`requested_start` text NOT NULL,
	`requested_end` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Jakarta' NOT NULL,
	`appointment_type` text DEFAULT 'FAMILY' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointments_facility_status_idx` ON `appointments` (`facility_id`,`status`);--> statement-breakpoint
CREATE INDEX `appointments_visitor_idx` ON `appointments` (`visitor_user_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`actor_role` text,
	`facility_id` text,
	`action_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`reason` text,
	`old_values` text,
	`new_values` text,
	`correlation_id` text NOT NULL,
	`request_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_facility_idx` ON `audit_events` (`facility_id`);--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_seen_at` text,
	`user_agent_hash` text,
	`ip_hash` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_hash_idx` ON `auth_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `credit_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` text NOT NULL,
	`user_id` text NOT NULL,
	`available_credits` integer DEFAULT 0 NOT NULL,
	`reserved_credits` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_accounts_user_facility_idx` ON `credit_accounts` (`user_id`,`facility_id`);--> statement-breakpoint
CREATE TABLE `credit_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_account_id` text NOT NULL,
	`appointment_id` text,
	`entry_type` text NOT NULL,
	`amount` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`reason` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`credit_account_id`) REFERENCES `credit_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_idempotency_idx` ON `credit_ledger_entries` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_ledger_account_idx` ON `credit_ledger_entries` (`credit_account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `facilities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Jakarta' NOT NULL,
	`current_state` text DEFAULT 'NORMAL_OPERATIONS' NOT NULL,
	`state_reason` text,
	`state_changed_at` text,
	`state_changed_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text,
	`facility_id` text,
	`payload` text NOT NULL,
	`correlation_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`processed_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_events_status_idx` ON `outbox_events` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `outbox_events_correlation_idx` ON `outbox_events` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`permission_key` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_key_idx` ON `permissions` (`permission_key`);--> statement-breakpoint
CREATE TABLE `resource_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` text DEFAULT 'HELD' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `resource_reservations_resource_idx` ON `resource_reservations` (`resource_type`,`resource_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `resource_reservations_appointment_idx` ON `resource_reservations` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permissions_pair_idx` ON `role_permissions` (`role_id`,`permission_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`facility_id` text,
	`event_type` text NOT NULL,
	`severity` text DEFAULT 'INFO' NOT NULL,
	`request_id` text,
	`ip_hash` text,
	`user_agent_hash` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_events_user_idx` ON `security_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `security_events_facility_idx` ON `security_events` (`facility_id`);--> statement-breakpoint
CREATE TABLE `staff_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`facility_id` text NOT NULL,
	`employee_reference` text NOT NULL,
	`job_title` text NOT NULL,
	`department` text,
	`shift_start` text,
	`shift_end` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `staff_profiles_facility_idx` ON `staff_profiles` (`facility_id`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`assigned_by` text,
	`assigned_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_scope_idx` ON `user_roles` (`user_id`,`role_id`,`facility_id`);--> statement-breakpoint
CREATE INDEX `user_roles_facility_idx` ON `user_roles` (`facility_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`user_type` text DEFAULT 'STAFF' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`email_verified_at` text,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_external_id_idx` ON `users` (`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);