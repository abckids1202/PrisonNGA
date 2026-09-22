CREATE TABLE IF NOT EXISTS visit_policy_history (
  id TEXT PRIMARY KEY NOT NULL,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (facility_id, version)
);
CREATE INDEX IF NOT EXISTS visit_policy_history_facility_created_idx
  ON visit_policy_history (facility_id, created_at);
