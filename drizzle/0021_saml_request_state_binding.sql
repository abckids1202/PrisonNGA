ALTER TABLE saml_request_cache ADD COLUMN state_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS saml_request_cache_state_hash_idx ON saml_request_cache (state_hash);
