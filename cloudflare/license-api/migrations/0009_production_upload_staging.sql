CREATE TABLE IF NOT EXISTS production_upload_staging_rows (
  batch_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  row_json TEXT NOT NULL,
  data_date TEXT NOT NULL DEFAULT '',
  edition_scope TEXT NOT NULL DEFAULT 'standard_pro',
  module TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, table_name, row_key, edition_scope)
);

CREATE INDEX IF NOT EXISTS idx_production_upload_staging_batch
  ON production_upload_staging_rows (batch_id, table_name);
