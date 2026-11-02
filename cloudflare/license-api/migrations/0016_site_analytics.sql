CREATE TABLE IF NOT EXISTS site_visit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_date TEXT NOT NULL,
  page_path TEXT NOT NULL,
  page_title TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  visitor_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_visit_events_date
  ON site_visit_events (event_date, page_path);

CREATE TABLE IF NOT EXISTS site_unique_visitors (
  event_date TEXT NOT NULL,
  page_path TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (event_date, page_path, visitor_hash)
);

CREATE TABLE IF NOT EXISTS site_page_daily (
  event_date TEXT NOT NULL,
  page_path TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  page_title TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  visit_count INTEGER NOT NULL DEFAULT 0,
  unique_visitor_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_date, page_path)
);

CREATE INDEX IF NOT EXISTS idx_site_page_daily_date
  ON site_page_daily (event_date, visit_count DESC);
