CREATE TABLE IF NOT EXISTS auth_challenge_delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES auth_challenges(id),
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS auth_challenge_delivery_challenge_idx ON auth_challenge_delivery_attempts (challenge_id, created_at);
CREATE INDEX IF NOT EXISTS auth_challenge_delivery_status_idx ON auth_challenge_delivery_attempts (status, created_at);
