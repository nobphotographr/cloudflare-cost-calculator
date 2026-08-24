CREATE TABLE IF NOT EXISTS notification_settings (
  account_hash TEXT PRIMARY KEY,
  webhook_url_encrypted TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  verified_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_notification_events (
  account_hash TEXT NOT NULL,
  month_key TEXT NOT NULL,
  threshold_ratio REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  estimate_usd REAL NOT NULL,
  budget_usd REAL NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_hash, month_key, threshold_ratio)
);

CREATE INDEX IF NOT EXISTS idx_budget_notification_events_account_updated
  ON budget_notification_events(account_hash, updated_at DESC);
