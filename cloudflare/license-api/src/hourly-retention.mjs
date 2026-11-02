/** Display-history retention, not raw research-history retention. */
export function hourlyRetentionWindow(now = new Date()) {
  const first = new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 7) + '-01';
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return [first, next.toISOString().slice(0, 10)];
}

const complete = (alias) => `(CASE WHEN json_valid(${alias}.row_json)
  THEN json_extract(${alias}.row_json, '$.quality_status') END)='complete'
  AND julianday(CASE WHEN json_valid(${alias}.row_json)
    THEN json_extract(${alias}.row_json, '$.available_at') END)<=julianday(?)`;

export function hourlyRetentionPredicate(alias = 'r', now = new Date()) {
  if (!['r', 's'].includes(alias)) throw new Error('invalid hourly SQL alias');
  const [first, next] = hourlyRetentionWindow(now);
  // Correlated by edition: a different edition's first October upload must not
  // remove September for customers who cannot read that October delivery.
  return {
    sql: `((${alias}.data_date>=? AND ${alias}.data_date<?) OR (
      (${alias}.edition_scope,${alias}.data_date) IN (SELECT h.edition_scope,MAX(h.data_date) FROM production_table_rows h
        JOIN production_upload_batches hb ON hb.batch_id=h.batch_id
        WHERE h.table_name='stock_hourly_history'
          AND hb.status='committed' AND h.data_date<? AND ${complete('h')}
        GROUP BY h.edition_scope
        HAVING h.edition_scope NOT IN (SELECT DISTINCT c.edition_scope FROM production_table_rows c
        JOIN production_upload_batches cb ON cb.batch_id=c.batch_id
        WHERE c.table_name='stock_hourly_history'
          AND cb.status='committed' AND c.data_date>=? AND c.data_date<? AND ${complete('c')}))))`,
    params: [first, next, first, now.toISOString(), first, next, now.toISOString()],
  };
}

export async function validateHourlyUploadRetention(env, batch, now = new Date()) {
  const manifest = JSON.parse(batch.manifest_json || '{}');
  const report = (manifest.tables || []).find(r => r.table_name === 'stock_hourly_history');
  if (!report) return '';
  const [first, next] = hourlyRetentionWindow(now);
  const previous = report.retained_previous_date || '';
  if (!previous) return ''; // Existing clients remain current-month-only.
  if (report.retention_month !== first.slice(0, 7) || !/^\d{4}-\d{2}-\d{2}$/.test(previous)
      || previous>=first || new Date(`${previous}T00:00:00Z`).toISOString().slice(0, 10)!==previous)
    throw new Error('hourly_history_month_changed_rebuild_upload');
  const row = await env.DB.prepare(`SELECT
    MAX(CASE WHEN h.data_date<? AND ${complete('h')} THEN h.data_date ELSE '' END) AS last_previous,
    SUM(CASE WHEN h.data_date>=? AND h.data_date<? AND ${complete('h')} THEN 1 ELSE 0 END) AS current_rows
    FROM production_table_rows h JOIN production_upload_batches b ON b.batch_id=h.batch_id
    WHERE h.table_name='stock_hourly_history' AND h.edition_scope=? AND b.status='committed'`)
    .bind(first, now.toISOString(), first, next, now.toISOString(), batch.edition_scope).first();
  if (Number(row?.current_rows || 0)>0 || (row?.last_previous && previous<row.last_previous))
    throw new Error('hourly_history_retention_changed_rebuild_upload');
  return previous;
}
