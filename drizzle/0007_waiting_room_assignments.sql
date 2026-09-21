ALTER TABLE `waiting_room_sessions` ADD COLUMN `assigned_room_id` text;
--> statement-breakpoint
ALTER TABLE `waiting_room_sessions` ADD COLUMN `assigned_kiosk_id` text;
--> statement-breakpoint
CREATE INDEX `waiting_room_sessions_assignment_idx` ON `waiting_room_sessions` (`facility_id`,`assigned_room_id`,`assigned_kiosk_id`);
