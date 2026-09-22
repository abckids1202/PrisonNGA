CREATE TABLE visitor_device_check_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  appointment_id TEXT NOT NULL REFERENCES appointments(id),
  visitor_user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  camera_result TEXT NOT NULL CHECK (camera_result IN ('ready', 'warning', 'failed')),
  microphone_result TEXT NOT NULL CHECK (microphone_result IN ('ready', 'warning', 'failed')),
  network_result TEXT NOT NULL CHECK (network_result IN ('stable', 'fair', 'poor', 'unknown')),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR (latency_ms >= 0 AND latency_ms <= 60000)),
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (idempotency_key)
);

CREATE INDEX visitor_device_check_appointment_idx
  ON visitor_device_check_attempts (appointment_id, created_at DESC);
CREATE INDEX visitor_device_check_visitor_idx
  ON visitor_device_check_attempts (visitor_user_id, created_at DESC);
