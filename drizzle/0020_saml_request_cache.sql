CREATE TABLE IF NOT EXISTS saml_request_cache (
  request_id TEXT PRIMARY KEY NOT NULL,
  issue_instant TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS saml_request_cache_created_idx ON saml_request_cache (created_at);
