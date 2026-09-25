CREATE TABLE IF NOT EXISTS facility_closures (
  id TEXT PRIMARY KEY NOT NULL,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at),
  CHECK (status IN ('ACTIVE', 'CANCELLED'))
);
CREATE INDEX IF NOT EXISTS facility_closures_window_idx
  ON facility_closures (facility_id, status, starts_at, ends_at);
