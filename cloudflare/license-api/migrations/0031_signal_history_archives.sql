-- Compact control-plane receipts only; public historical payloads live in R2.
CREATE TABLE IF NOT EXISTS production_signal_archives (
  archive_id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL CHECK(table_name IN ('stock_signal_observation_daily','stock_daily_latest','stock_daily_ohlcv','stock_risk_metrics')),
  edition_scope TEXT NOT NULL,
  data_date TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  raw_bytes INTEGER NOT NULL,
  gzip_bytes INTEGER NOT NULL,
  raw_hash TEXT NOT NULL,
  gzip_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','verified','pruned')),
  verified_at TEXT NOT NULL DEFAULT '',
  local_copy_hash TEXT NOT NULL DEFAULT '',
  local_verified_at TEXT NOT NULL DEFAULT '',
  pruned_rows INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_signal_archives_partition
ON production_signal_archives(table_name,edition_scope,data_date,key_prefix,state);
