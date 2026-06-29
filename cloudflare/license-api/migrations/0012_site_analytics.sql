CREATE TABLE IF NOT EXISTS site_visit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_date TEXT NOT NULL,
  page_path TEXT NOT NULL,
  page_title TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  visitor_hash TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS release_download_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_date TEXT NOT NULL,
  release_id INTEGER NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  edition TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  license_id TEXT NOT NULL DEFAULT '',
  client_ip_hash TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'release_download',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_release_download_events_release
  ON release_download_events (release_id, event_date);

CREATE TABLE IF NOT EXISTS release_download_daily (
  event_date TEXT NOT NULL,
  release_id INTEGER NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  edition TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  download_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_date, release_id)
);

CREATE INDEX IF NOT EXISTS idx_release_download_daily_date
  ON release_download_daily (event_date, download_count DESC);
