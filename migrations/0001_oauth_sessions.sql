CREATE TABLE IF NOT EXISTS oauth_sessions (
  session_hash TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL,
  code_verifier_encrypted TEXT NOT NULL,
  token_set_encrypted TEXT,
  account_options_json TEXT NOT NULL DEFAULT '[]',
  selected_account_id TEXT,
  selected_account_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('authorizing', 'connected', 'expired', 'failed')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires_at ON oauth_sessions(expires_at);
