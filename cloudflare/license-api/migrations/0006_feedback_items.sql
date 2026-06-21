CREATE TABLE IF NOT EXISTS feedback_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'experience',
  product_area TEXT NOT NULL DEFAULT 'website',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'new',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  contact_email TEXT,
  page_url TEXT,
  client_version TEXT,
  environment TEXT,
  rating INTEGER,
  survey_answers TEXT NOT NULL DEFAULT '{}',
  admin_notes TEXT,
  client_ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_items_status_time
  ON feedback_items (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_feedback_items_type_time
  ON feedback_items (type, created_at);

CREATE INDEX IF NOT EXISTS idx_feedback_items_contact
  ON feedback_items (contact_email);
