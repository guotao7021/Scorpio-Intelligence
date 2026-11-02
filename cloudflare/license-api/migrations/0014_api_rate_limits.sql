CREATE TABLE IF NOT EXISTS api_rate_limits (
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, subject)
);
