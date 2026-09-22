ALTER TABLE incidents ADD COLUMN idempotency_key TEXT;
ALTER TABLE incidents ADD COLUMN request_hash TEXT;

CREATE UNIQUE INDEX incidents_create_idempotency_idx
  ON incidents (facility_id, reporter_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
