ALTER TABLE `staff_profiles` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `staff_facility_assignments` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `user_roles` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `security_events` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `audit_export_manifests` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `retention_policies` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);

UPDATE `staff_profiles` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `staff_profiles`.`facility_id`) WHERE `organization_id` IS NULL;
UPDATE `staff_facility_assignments` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `staff_facility_assignments`.`facility_id`) WHERE `organization_id` IS NULL;
UPDATE `user_roles` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `user_roles`.`facility_id`) WHERE `organization_id` IS NULL;
UPDATE `security_events` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `security_events`.`facility_id`) WHERE `organization_id` IS NULL AND `facility_id` IS NOT NULL;
UPDATE `audit_export_manifests` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `audit_export_manifests`.`facility_id`) WHERE `organization_id` IS NULL;
UPDATE `retention_policies` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = `retention_policies`.`facility_id`) WHERE `organization_id` IS NULL;

CREATE INDEX `staff_profiles_organization_idx` ON `staff_profiles` (`organization_id`, `facility_id`);
CREATE INDEX `staff_facility_assignments_organization_idx` ON `staff_facility_assignments` (`organization_id`, `facility_id`, `status`);
CREATE INDEX `user_roles_organization_idx` ON `user_roles` (`organization_id`, `facility_id`);
CREATE INDEX `security_events_organization_idx` ON `security_events` (`organization_id`, `facility_id`, `created_at`);
CREATE INDEX `audit_export_manifests_organization_idx` ON `audit_export_manifests` (`organization_id`, `facility_id`, `created_at`);
CREATE INDEX `retention_policies_organization_idx` ON `retention_policies` (`organization_id`, `facility_id`, `evidence_type`);

CREATE TRIGGER `staff_profiles_organization_fill`
AFTER INSERT ON `staff_profiles`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `staff_profiles` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = NEW.`facility_id`) WHERE `user_id` = NEW.`user_id`;
END;
CREATE TRIGGER `staff_facility_assignments_organization_fill`
AFTER INSERT ON `staff_facility_assignments`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `staff_facility_assignments` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = NEW.`facility_id`) WHERE `user_id` = NEW.`user_id` AND `facility_id` = NEW.`facility_id`;
END;
CREATE TRIGGER `user_roles_organization_fill`
AFTER INSERT ON `user_roles`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `user_roles` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = NEW.`facility_id`) WHERE `user_id` = NEW.`user_id` AND `role_id` = NEW.`role_id` AND `facility_id` = NEW.`facility_id`;
END;
CREATE TRIGGER `security_events_organization_fill`
AFTER INSERT ON `security_events`
WHEN NEW.`organization_id` IS NULL AND NEW.`facility_id` IS NOT NULL
BEGIN
  UPDATE `security_events` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = NEW.`facility_id`) WHERE `id` = NEW.`id`;
END;
CREATE TRIGGER `audit_export_manifests_organization_fill`
AFTER INSERT ON `audit_export_manifests`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `audit_export_manifests` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = NEW.`facility_id`) WHERE `id` = NEW.`id`;
END;
CREATE TRIGGER `retention_policies_organization_fill`
AFTER INSERT ON `retention_policies`
WHEN NEW.`organization_id` IS NULL
BEGIN
  UPDATE `retention_policies` SET `organization_id` = (SELECT `organization_id` FROM `facilities` WHERE `facilities`.`id` = NEW.`facility_id`) WHERE `id` = NEW.`id`;
END;
