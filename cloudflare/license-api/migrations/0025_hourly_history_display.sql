-- 60-minute business projection uses the existing atomic upload/commit store.
-- This read-only view exposes only committed, licensed delivery scopes; no
-- separate physical copy and no 5-minute/research data or business uploads.
CREATE VIEW IF NOT EXISTS stock_hourly_history AS
SELECT
  json_extract(r.row_json, '$.code') AS code,
  json_extract(r.row_json, '$.trade_date') AS trade_date,
  json_extract(r.row_json, '$.interval_minutes') AS interval_minutes,
  json_extract(r.row_json, '$.data_source') AS data_source,
  json_extract(r.row_json, '$.price_basis') AS price_basis,
  json_extract(r.row_json, '$.snapshot_id') AS snapshot_id,
  json_extract(r.row_json, '$.available_at') AS available_at,
  json_extract(r.row_json, '$.quality_status') AS quality_status,
  json_extract(r.row_json, '$.bars_json') AS bars_json,
  r.edition_scope, r.batch_id, r.updated_at
FROM production_table_rows r
JOIN production_upload_batches b ON b.batch_id = r.batch_id
WHERE r.table_name = 'stock_hourly_history' AND r.module = 'market_context'
  AND b.status = 'committed' AND json_valid(r.row_json)
  AND r.data_date >= date('now', '+8 hours', 'start of month')
  AND r.data_date < date('now', '+8 hours', 'start of month', '+1 month')
  AND json_extract(r.row_json, '$.interval_minutes') = 60
  AND json_extract(r.row_json, '$.data_source') = 'tushare.stk_mins';
