ALTER TABLE release_versions ADD COLUMN r2_key TEXT NOT NULL DEFAULT '';
ALTER TABLE release_versions ADD COLUMN file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE release_versions ADD COLUMN content_type TEXT NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE release_versions ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE release_versions ADD COLUMN uploaded_at TEXT NOT NULL DEFAULT '';
ALTER TABLE release_versions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_release_versions_r2_key
  ON release_versions (r2_key);

CREATE INDEX IF NOT EXISTS idx_release_versions_active
  ON release_versions (is_active, channel, edition, released_at);
