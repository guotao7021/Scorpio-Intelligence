-- Metadata-only view replacement. No business/history rows are deleted.
-- Keep the last usable previous trading-day partition independently per edition
-- until a complete, committed, already-available current-month row is present.
DROP VIEW IF EXISTS stock_hourly_history;
CREATE VIEW stock_hourly_history AS
SELECT json_extract(r.row_json,'$.code') AS code,
  json_extract(r.row_json,'$.trade_date') AS trade_date,
  json_extract(r.row_json,'$.interval_minutes') AS interval_minutes,
  json_extract(r.row_json,'$.data_source') AS data_source,
  json_extract(r.row_json,'$.price_basis') AS price_basis,
  json_extract(r.row_json,'$.snapshot_id') AS snapshot_id,
  json_extract(r.row_json,'$.available_at') AS available_at,
  json_extract(r.row_json,'$.quality_status') AS quality_status,
  json_extract(r.row_json,'$.bars_json') AS bars_json,
  r.edition_scope,r.batch_id,r.updated_at
FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
WHERE r.table_name='stock_hourly_history' AND r.module='market_context'
  AND b.status='committed' AND json_valid(r.row_json)
  AND json_extract(r.row_json,'$.interval_minutes')=60
  AND json_extract(r.row_json,'$.data_source')='tushare.stk_mins'
  AND ((r.data_date>=date('now','+8 hours','start of month')
        AND r.data_date<date('now','+8 hours','start of month','+1 month'))
    OR ((r.edition_scope,r.data_date) IN (SELECT h.edition_scope,MAX(h.data_date) FROM production_table_rows h
        JOIN production_upload_batches hb ON hb.batch_id=h.batch_id
        WHERE h.table_name='stock_hourly_history'
          AND hb.status='committed' AND h.data_date<date('now','+8 hours','start of month')
          AND (CASE WHEN json_valid(h.row_json) THEN json_extract(h.row_json,'$.quality_status') END)='complete'
          AND julianday(CASE WHEN json_valid(h.row_json) THEN json_extract(h.row_json,'$.available_at') END)<=julianday('now')
        GROUP BY h.edition_scope
        HAVING h.edition_scope NOT IN (SELECT DISTINCT c.edition_scope FROM production_table_rows c
        JOIN production_upload_batches cb ON cb.batch_id=c.batch_id
        WHERE c.table_name='stock_hourly_history'
          AND cb.status='committed' AND c.data_date>=date('now','+8 hours','start of month')
          AND c.data_date<date('now','+8 hours','start of month','+1 month')
          AND (CASE WHEN json_valid(c.row_json) THEN json_extract(c.row_json,'$.quality_status') END)='complete'
          AND julianday(CASE WHEN json_valid(c.row_json) THEN json_extract(c.row_json,'$.available_at') END)<=julianday('now')))));
