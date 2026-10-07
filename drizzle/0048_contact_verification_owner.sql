ALTER TABLE `auth_challenges` ADD COLUMN `user_id` text REFERENCES `users`(`id`);
CREATE INDEX `auth_challenges_user_idx` ON `auth_challenges` (`user_id`, `created_at`);
