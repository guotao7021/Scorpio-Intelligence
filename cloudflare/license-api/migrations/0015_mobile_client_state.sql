CREATE TABLE IF NOT EXISTS mobile_portfolio_snapshots (
  user_id INTEGER PRIMARY KEY,
  positions_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mobile_portfolio_snapshots_updated_at
  ON mobile_portfolio_snapshots(updated_at);

CREATE TABLE IF NOT EXISTS mobile_watchlists (
  user_id INTEGER PRIMARY KEY,
  items_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mobile_watchlists_updated_at
  ON mobile_watchlists(updated_at);
