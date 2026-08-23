CREATE TABLE IF NOT EXISTS usage_snapshots (
  account_hash TEXT NOT NULL,
  captured_on TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  days_observed INTEGER NOT NULL,
  days_in_month INTEGER NOT NULL,
  r2_storage_gb_month REAL NOT NULL,
  r2_class_a REAL NOT NULL,
  r2_class_b REAL NOT NULL,
  workers_requests REAL NOT NULL,
  workers_cpu_p50_ms REAL NOT NULL,
  workers_cpu_p99_ms REAL NOT NULL,
  d1_rows_read REAL NOT NULL,
  d1_rows_written REAL NOT NULL,
  d1_storage_gb REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_hash, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_usage_snapshots_account_date
  ON usage_snapshots(account_hash, captured_on DESC);

CREATE TABLE IF NOT EXISTS budget_settings (
  account_hash TEXT PRIMARY KEY,
  monthly_budget_usd REAL NOT NULL CHECK (monthly_budget_usd >= 0),
  thresholds_json TEXT NOT NULL DEFAULT '[0.5,0.8,1]',
  updated_at TEXT NOT NULL
);
