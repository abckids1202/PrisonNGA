CREATE TABLE `incidents` (
  `id` text PRIMARY KEY NOT NULL, `facility_id` text NOT NULL, `incident_type` text NOT NULL, `severity` text NOT NULL, `status` text DEFAULT 'OPEN' NOT NULL, `title` text NOT NULL, `description` text NOT NULL, `appointment_id` text, `session_id` text, `resource_id` text, `reporter_user_id` text NOT NULL, `assigned_user_id` text, `resolution` text, `version` integer DEFAULT 1 NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `incidents_facility_status_idx` ON `incidents` (`facility_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `incidents_appointment_idx` ON `incidents` (`appointment_id`);
--> statement-breakpoint
CREATE INDEX `incidents_severity_idx` ON `incidents` (`facility_id`,`severity`);
--> statement-breakpoint
CREATE TABLE `incident_events` (`id` text PRIMARY KEY NOT NULL, `incident_id` text NOT NULL, `event_type` text NOT NULL, `actor_user_id` text NOT NULL, `details` text NOT NULL, `correlation_id` text NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE no action, FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action);
--> statement-breakpoint
CREATE INDEX `incident_events_incident_idx` ON `incident_events` (`incident_id`,`created_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO roles (id, name, description) VALUES
  ('role-scheduling-officer', 'Scheduling Officer', 'Reviews and coordinates visitation appointments.'),
  ('role-verification-officer', 'Verification Officer', 'Reviews visitor identity and relationship evidence.'),
  ('role-monitoring-officer', 'Monitoring Officer', 'Monitors authorized active sessions and incidents.'),
  ('role-supervisor', 'Supervisor', 'Approves exceptional actions and facility state changes.'),
  ('role-auditor', 'Auditor', 'Reads compliance records and exports authorized audit reports.');
--> statement-breakpoint
INSERT OR IGNORE INTO permissions (id, permission_key, description) VALUES ('perm-incident-read', 'incident.read', 'Read facility incident records.'), ('perm-incident-manage', 'incident.manage', 'Create and resolve facility incidents.');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role-monitoring-officer', 'perm-incident-read'), ('role-monitoring-officer', 'perm-incident-manage'), ('role-supervisor', 'perm-incident-read'), ('role-supervisor', 'perm-incident-manage'), ('role-auditor', 'perm-incident-read');
