ALTER TABLE feedback_items ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE feedback_items ADD COLUMN public_reply TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_feedback_owner ON feedback_items(user_id, created_at DESC);
CREATE TABLE feedback_attachments (
  attachment_id TEXT PRIMARY KEY,
  feedback_id INTEGER NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_feedback_attachments_parent ON feedback_attachments(feedback_id);
CREATE TABLE feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reply TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_feedback_events_parent ON feedback_events(feedback_id, id);
