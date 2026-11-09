ALTER TABLE `evidence_documents` ADD COLUMN `scan_status` text NOT NULL DEFAULT 'CLEAN';
ALTER TABLE `evidence_documents` ADD COLUMN `scan_provider` text;
ALTER TABLE `evidence_documents` ADD COLUMN `scan_reference` text;
ALTER TABLE `evidence_documents` ADD COLUMN `scan_requested_at` text;
ALTER TABLE `evidence_documents` ADD COLUMN `scan_completed_at` text;
ALTER TABLE `evidence_documents` ADD COLUMN `scan_error` text;

-- A callback can arrive more than once, and a provider event identity must be
-- retained independently of the mutable quarantine row for replay detection.
CREATE TABLE `evidence_scan_events` (
  `id` text PRIMARY KEY NOT NULL,
  `event_id` text NOT NULL,
  `provider` text NOT NULL,
  `scan_reference` text NOT NULL,
  `evidence_id` text,
  `organization_id` text REFERENCES `organizations`(`id`),
  `facility_id` text REFERENCES `facilities`(`id`),
  `verdict` text NOT NULL,
  `payload` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX `evidence_scan_events_provider_event_idx` ON `evidence_scan_events` (`provider`, `event_id`);
CREATE INDEX `evidence_scan_events_reference_idx` ON `evidence_scan_events` (`provider`, `scan_reference`, `created_at`);
CREATE INDEX `evidence_scan_events_organization_idx` ON `evidence_scan_events` (`organization_id`, `facility_id`, `created_at`);
CREATE INDEX `evidence_documents_scan_idx` ON `evidence_documents` (`facility_id`, `scan_status`, `status`, `scan_requested_at`);
