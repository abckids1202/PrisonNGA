ALTER TABLE waiting_room_sessions ADD COLUMN visitor_presence_at TEXT;
--> statement-breakpoint
ALTER TABLE waiting_room_sessions ADD COLUMN prisoner_presence_at TEXT;
--> statement-breakpoint
CREATE INDEX waiting_room_sessions_presence_freshness_idx ON waiting_room_sessions (facility_id, visitor_presence_at, prisoner_presence_at);
