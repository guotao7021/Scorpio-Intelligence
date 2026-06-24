CREATE TABLE IF NOT EXISTS data_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id TEXT NOT NULL UNIQUE,
  edition TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  version TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  data_date TEXT NOT NULL DEFAULT '',
  valid_from TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  min_client_version TEXT NOT NULL DEFAULT '',
  detail_level TEXT NOT NULL DEFAULT 'pro',
  r2_key TEXT NOT NULL DEFAULT '',
  download_url TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  capability_scope TEXT NOT NULL DEFAULT '{}',
  manifest_summary TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_packages_active
  ON data_packages (edition, channel, is_active, published_at);

CREATE TABLE IF NOT EXISTS device_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  machine_fingerprint TEXT NOT NULL DEFAULT '',
  package_id TEXT NOT NULL DEFAULT '',
  edition TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'stable',
  client_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  error_message TEXT NOT NULL DEFAULT '',
  client_ip TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_sync_logs_license
  ON device_sync_logs (license_id, synced_at);

CREATE INDEX IF NOT EXISTS idx_device_sync_logs_package
  ON device_sync_logs (package_id, synced_at);
