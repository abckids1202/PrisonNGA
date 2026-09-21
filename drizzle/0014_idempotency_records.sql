CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  response_status INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_records_scope_key_idx ON idempotency_records (scope, idempotency_key);
CREATE INDEX IF NOT EXISTS idempotency_records_created_idx ON idempotency_records (created_at);
