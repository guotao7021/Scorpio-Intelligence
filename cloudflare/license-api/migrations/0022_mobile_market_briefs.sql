CREATE TABLE IF NOT EXISTS mobile_market_briefs (
  brief_id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '雪球公开简报',
  source_url TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_market_briefs_date
  ON mobile_market_briefs (is_active, trade_date DESC, published_at DESC);
