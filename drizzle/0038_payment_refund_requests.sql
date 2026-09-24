CREATE TABLE `payment_refund_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `facility_id` text NOT NULL,
  `payment_intent_id` text NOT NULL,
  `requested_by` text NOT NULL,
  `provider` text NOT NULL,
  `provider_reference` text,
  `amount_minor` integer NOT NULL,
  `currency` text NOT NULL,
  `reason` text NOT NULL,
  `status` text DEFAULT 'REQUESTED' NOT NULL,
  `idempotency_key` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`payment_intent_id`) REFERENCES `payment_intents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_refund_requests_idempotency_idx` ON `payment_refund_requests` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `payment_refund_requests_facility_status_idx` ON `payment_refund_requests` (`facility_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `payment_refund_requests_payment_idx` ON `payment_refund_requests` (`payment_intent_id`,`created_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO permissions (id, permission_key, description)
VALUES ('perm-finance-manage', 'finance.manage', 'Request provider refunds and operate facility payment exceptions.');
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles, permissions
WHERE roles.name = 'Supervisor' AND permissions.permission_key = 'finance.manage';
