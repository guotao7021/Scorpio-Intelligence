ALTER TABLE release_versions ADD COLUMN hk_download_url TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_release_versions_hk_download_url
  ON release_versions (hk_download_url);
