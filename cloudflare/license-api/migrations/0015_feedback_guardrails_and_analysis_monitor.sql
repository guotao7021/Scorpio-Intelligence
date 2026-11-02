CREATE INDEX IF NOT EXISTS idx_feedback_items_ip_created
  ON feedback_items (client_ip, created_at);

CREATE TABLE IF NOT EXISTS analysis_monitor_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  checked_at TEXT NOT NULL,
  compute_ok INTEGER NOT NULL,
  cache_ready INTEGER NOT NULL,
  mode TEXT NOT NULL,
  message TEXT,
  last_alert_at TEXT
);
