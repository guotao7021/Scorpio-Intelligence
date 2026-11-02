CREATE TABLE IF NOT EXISTS mobile_device_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  license_id TEXT NOT NULL,
  machine_fingerprint TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  device_label TEXT NOT NULL DEFAULT 'Android',
  client_version TEXT NOT NULL DEFAULT '',
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(user_id, machine_fingerprint),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mobile_device_bindings_license
  ON mobile_device_bindings(user_id, license_id, revoked);
