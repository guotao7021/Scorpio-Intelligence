-- Accelerate mobile stock lookups without scanning row_json with multiple LIKE clauses.
CREATE INDEX IF NOT EXISTS idx_production_table_rows_asset_code
ON production_table_rows (
  table_name,
  edition_scope,
  UPPER(CASE
    WHEN json_valid(row_json) THEN COALESCE(
      json_extract(row_json, '$.code'),
      json_extract(row_json, '$.stock_code'),
      json_extract(row_json, '$.symbol'),
      json_extract(row_json, '$.ts_code'),
      json_extract(row_json, '$.asset_code'),
      json_extract(row_json, '$.fund_code'),
      json_extract(row_json, '$.bond_code'),
      ''
    ) ELSE ''
  END),
  data_date DESC
);
