CREATE TABLE IF NOT EXISTS production_upload_batches (
  batch_id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'self_use_production',
  mode TEXT NOT NULL DEFAULT 'module',
  edition_scope TEXT NOT NULL DEFAULT 'standard_pro',
  status TEXT NOT NULL DEFAULT 'created',
  table_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  received_row_count INTEGER NOT NULL DEFAULT 0,
  received_chunk_count INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  manifest_hash TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  committed_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_production_upload_batches_status
  ON production_upload_batches (status, created_at);

CREATE INDEX IF NOT EXISTS idx_production_upload_batches_module
  ON production_upload_batches (module, edition_scope, created_at);

CREATE TABLE IF NOT EXISTS production_upload_chunks (
  batch_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  chunk_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, table_name, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_production_upload_chunks_batch
  ON production_upload_chunks (batch_id, table_name);

CREATE TABLE IF NOT EXISTS production_table_rows (
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  row_json TEXT NOT NULL,
  data_date TEXT NOT NULL DEFAULT '',
  edition_scope TEXT NOT NULL DEFAULT 'standard_pro',
  module TEXT NOT NULL DEFAULT '',
  batch_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (table_name, row_key, edition_scope)
);

CREATE INDEX IF NOT EXISTS idx_production_table_rows_lookup
  ON production_table_rows (table_name, edition_scope, data_date);

CREATE INDEX IF NOT EXISTS idx_production_table_rows_batch
  ON production_table_rows (batch_id);
