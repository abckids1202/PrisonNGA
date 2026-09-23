ALTER TABLE waiting_room_sessions ADD COLUMN kiosk_camera_state TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE waiting_room_sessions ADD COLUMN kiosk_microphone_state TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE waiting_room_sessions ADD COLUMN kiosk_network_state TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE waiting_room_sessions ADD COLUMN kiosk_device_checked_at TEXT;

CREATE TABLE kiosk_device_check_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  appointment_id TEXT NOT NULL REFERENCES appointments(id),
  resource_id TEXT NOT NULL REFERENCES resources(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  camera_result TEXT NOT NULL CHECK (camera_result IN ('ready', 'warning', 'failed')),
  microphone_result TEXT NOT NULL CHECK (microphone_result IN ('ready', 'warning', 'failed')),
  network_result TEXT NOT NULL CHECK (network_result IN ('stable', 'fair', 'poor', 'unknown')),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR (latency_ms >= 0 AND latency_ms <= 60000)),
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX kiosk_device_check_appointment_idx
  ON kiosk_device_check_attempts (appointment_id, created_at DESC);
CREATE INDEX kiosk_device_check_resource_idx
  ON kiosk_device_check_attempts (resource_id, created_at DESC);
