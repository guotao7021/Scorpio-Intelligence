CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  customer_name TEXT,
  customer_email TEXT,
  edition TEXT NOT NULL DEFAULT 'personal_pro',
  machine_fingerprint_prebind TEXT,
  license_days INTEGER NOT NULL DEFAULT 365,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_email
  ON customers (customer_email);

CREATE INDEX IF NOT EXISTS idx_customers_status
  ON customers (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_activation_codes_customer
  ON activation_codes (customer_id, status);
