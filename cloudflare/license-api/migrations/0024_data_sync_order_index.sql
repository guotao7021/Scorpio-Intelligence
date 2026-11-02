-- Keep deep row-sync pages ordered by their stable cursor fields without
-- sorting every rich production payload on every request.
CREATE INDEX IF NOT EXISTS idx_production_table_rows_sync_order
ON production_table_rows(table_name, updated_at, row_key, edition_scope);
