CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 1,
  registered_ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  edition TEXT NOT NULL,
  license_days INTEGER NOT NULL DEFAULT 365,
  max_devices INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  assigned_to_user_id INTEGER,
  customer_id INTEGER,
  customer_name TEXT,
  customer_email TEXT,
  machine_fingerprint_prebind TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  used_by_user_id INTEGER,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_activation_codes_assigned_to
  ON activation_codes (assigned_to_user_id, status);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  activation_code_id INTEGER,
  license_id TEXT NOT NULL UNIQUE,
  edition TEXT NOT NULL,
  machine_fingerprint TEXT,
  machine_fingerprint_history TEXT NOT NULL DEFAULT '[]',
  signed_payload TEXT NOT NULL,
  signature TEXT NOT NULL,
  nonce TEXT,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  revoked INTEGER NOT NULL DEFAULT 0,
  revoke_reason TEXT,
  approval_status TEXT NOT NULL DEFAULT 'auto',
  last_online_check TEXT,
  max_offline_days INTEGER NOT NULL DEFAULT 7,
  suspicious_flag INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_licenses_user_active
  ON licenses (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_licenses_machine_fingerprint
  ON licenses (machine_fingerprint);
CREATE INDEX IF NOT EXISTS idx_licenses_expires_at
  ON licenses (expires_at);

CREATE TABLE IF NOT EXISTS validation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL,
  user_id INTEGER,
  machine_fingerprint TEXT,
  client_version TEXT,
  client_ip TEXT,
  is_valid INTEGER NOT NULL,
  fail_reason TEXT,
  nonce TEXT,
  validated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validation_logs_license_time
  ON validation_logs (license_id, validated_at);

CREATE TABLE IF NOT EXISTS usage_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL,
  user_id INTEGER,
  machine_fingerprint TEXT,
  session_start TEXT,
  session_end TEXT,
  session_duration_seconds INTEGER NOT NULL DEFAULT 0,
  feature_usage TEXT NOT NULL DEFAULT '{}',
  client_version TEXT,
  os_version TEXT,
  reported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_reports_license_time
  ON usage_reports (license_id, reported_at);

CREATE TABLE IF NOT EXISTS release_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  edition TEXT NOT NULL DEFAULT 'all',
  release_notes TEXT,
  download_url TEXT,
  file_hash_sha256 TEXT,
  file_size_bytes INTEGER,
  is_required INTEGER NOT NULL DEFAULT 0,
  released_at TEXT NOT NULL,
  UNIQUE(version, channel, edition)
);

CREATE INDEX IF NOT EXISTS idx_release_versions_lookup
  ON release_versions (channel, edition, released_at);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);
