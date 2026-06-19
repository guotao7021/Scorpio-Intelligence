CREATE TABLE IF NOT EXISTS analysis_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  license_id TEXT,
  endpoint TEXT NOT NULL,
  asset_type TEXT,
  asset_code TEXT,
  request_hash TEXT,
  client_version TEXT,
  client_ip TEXT,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_requests_user_time
  ON analysis_requests (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_analysis_requests_asset_time
  ON analysis_requests (asset_type, asset_code, created_at);
