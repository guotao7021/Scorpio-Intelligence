DROP TABLE IF EXISTS analysis_replay_nonces_next;

CREATE TABLE analysis_replay_nonces_next (
  user_id INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  request_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, nonce)
);

INSERT OR IGNORE INTO analysis_replay_nonces_next
  (user_id, nonce, request_hash, expires_at, created_at)
SELECT
  COALESCE(user_id, 0),
  nonce,
  request_hash,
  expires_at,
  created_at
FROM analysis_replay_nonces
WHERE nonce IS NOT NULL AND nonce != '';

DROP TABLE analysis_replay_nonces;

ALTER TABLE analysis_replay_nonces_next RENAME TO analysis_replay_nonces;

CREATE INDEX IF NOT EXISTS idx_analysis_replay_nonces_expires
  ON analysis_replay_nonces (expires_at);
