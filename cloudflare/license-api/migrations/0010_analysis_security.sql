CREATE TABLE IF NOT EXISTS analysis_rate_limits (
  key TEXT PRIMARY KEY,
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_rate_limits_updated
  ON analysis_rate_limits (updated_at);

CREATE TABLE IF NOT EXISTS analysis_replay_nonces (
  nonce TEXT PRIMARY KEY,
  user_id INTEGER,
  request_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_replay_nonces_expires
  ON analysis_replay_nonces (expires_at);
