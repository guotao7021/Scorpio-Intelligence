CREATE TABLE IF NOT EXISTS public_rate_limits (
  key TEXT PRIMARY KEY,
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_rate_limits_updated
  ON public_rate_limits (updated_at);
