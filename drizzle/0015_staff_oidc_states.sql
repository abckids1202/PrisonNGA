CREATE TABLE IF NOT EXISTS auth_federation_states (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_federation_states_hash_idx ON auth_federation_states (state_hash);
CREATE INDEX IF NOT EXISTS auth_federation_states_expires_idx ON auth_federation_states (expires_at);
