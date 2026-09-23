-- Keep the existing users table and all foreign keys intact. A phone-only
-- visitor receives an internal, non-deliverable email identity in the
-- required legacy column; the verified phone is the actual contact identity.
ALTER TABLE `users` ADD COLUMN `phone` text;
ALTER TABLE `users` ADD COLUMN `phone_verified_at` text;
CREATE UNIQUE INDEX `users_phone_idx` ON `users` (`phone`);
