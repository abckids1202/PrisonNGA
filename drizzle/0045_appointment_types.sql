CREATE TABLE IF NOT EXISTS appointment_types (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL REFERENCES facilities(id),
  `code` text NOT NULL,
  `display_name` text NOT NULL,
  `description` text NOT NULL,
  `duration_minutes` integer NOT NULL,
  `credit_cost` integer NOT NULL DEFAULT 1,
  `status` text NOT NULL DEFAULT 'ACTIVE',
  `version` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (duration_minutes > 0),
  CHECK (credit_cost > 0),
  CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS appointment_types_facility_code_idx ON appointment_types (facility_id, code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointment_types_facility_status_idx ON appointment_types (facility_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS appointment_type_history (
  `id` text PRIMARY KEY NOT NULL,
  `appointment_type_id` text NOT NULL REFERENCES appointment_types(id),
  `facility_id` text NOT NULL REFERENCES facilities(id),
  `version` integer NOT NULL,
  `actor_user_id` text NOT NULL REFERENCES users(id),
  `reason` text NOT NULL,
  `snapshot` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS appointment_type_history_version_idx ON appointment_type_history (appointment_type_id, version);
--> statement-breakpoint
INSERT OR IGNORE INTO appointment_types (id, facility_id, code, display_name, description, duration_minutes, credit_cost)
SELECT 'appointment-type-' || f.id || '-family', f.id, 'FAMILY', 'Family visit', 'Standard approved visitor relationship visit.', 30, 1
FROM facilities f;
--> statement-breakpoint
INSERT OR IGNORE INTO appointment_types (id, facility_id, code, display_name, description, duration_minutes, credit_cost)
SELECT 'appointment-type-' || f.id || '-legal', f.id, 'LEGAL', 'Legal visit', 'Professional or legal representative visit subject to facility review.', 30, 1
FROM facilities f;
