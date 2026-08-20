ALTER TABLE release_versions ADD COLUMN platform TEXT NOT NULL DEFAULT 'desktop';

CREATE UNIQUE INDEX IF NOT EXISTS idx_release_versions_platform_identity
  ON release_versions (version, channel, edition, platform);

CREATE INDEX IF NOT EXISTS idx_release_versions_platform_lookup
  ON release_versions (platform, channel, edition, released_at);
