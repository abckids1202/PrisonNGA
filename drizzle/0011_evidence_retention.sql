CREATE TABLE `evidence_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL REFERENCES facilities(id),
  `verification_case_id` text NOT NULL REFERENCES verification_cases(id),
  `visitor_user_id` text NOT NULL REFERENCES users(id),
  `storage_key` text NOT NULL,
  `original_filename` text NOT NULL,
  `content_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `sha256` text NOT NULL,
  `status` text DEFAULT 'AVAILABLE' NOT NULL,
  `retention_until` text NOT NULL,
  `legal_hold` integer DEFAULT 0 NOT NULL,
  `created_by` text NOT NULL,
  `deleted_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_documents_case_idx` ON `evidence_documents` (`verification_case_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `evidence_documents_retention_idx` ON `evidence_documents` (`facility_id`,`retention_until`,`legal_hold`);
--> statement-breakpoint
CREATE TABLE `retention_policies` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL REFERENCES facilities(id),
  `evidence_type` text DEFAULT 'VISITOR_VERIFICATION' NOT NULL,
  `retention_days` integer NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `effective_at` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retention_policies_facility_type_idx` ON `retention_policies` (`facility_id`,`evidence_type`);
--> statement-breakpoint
CREATE TABLE `legal_holds` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL REFERENCES facilities(id),
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `reason` text NOT NULL,
  `status` text DEFAULT 'ACTIVE' NOT NULL,
  `created_by` text NOT NULL,
  `released_by` text,
  `released_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `legal_holds_entity_idx` ON `legal_holds` (`facility_id`,`entity_type`,`entity_id`,`status`);
