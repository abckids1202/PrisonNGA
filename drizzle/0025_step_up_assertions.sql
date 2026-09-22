CREATE TABLE step_up_assertions (
  nonce_hash TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX step_up_assertions_expiry_idx ON step_up_assertions(expires_at);
