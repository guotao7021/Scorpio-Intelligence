CREATE TABLE IF NOT EXISTS auth_verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  client_ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_verification_codes_lookup
  ON auth_verification_codes(email, purpose, id DESC);

CREATE TABLE IF NOT EXISTS account_operations (
  operation_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  mutation_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_license_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  license_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(operation_id, license_id)
);
CREATE INDEX IF NOT EXISTS idx_account_license_events_user
  ON account_license_events(user_id, id DESC);

CREATE TABLE IF NOT EXISTS account_service_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  license_id TEXT NOT NULL,
  requested_days INTEGER NOT NULL CHECK(requested_days BETWEEN 1 AND 3660),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_requests_status
  ON account_service_requests(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_account_requests_user
  ON account_service_requests(user_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_requests_pending_license
  ON account_service_requests(user_id, license_id) WHERE status = 'pending';
