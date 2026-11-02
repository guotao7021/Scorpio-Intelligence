/** Stock read eligibility, not publication approval or trading authority. */
function reject(status, message) { throw Object.assign(new Error(message), {status, publicMessage: message}); }

export async function authorizeStockRead(env, {user, license, code, businessDate='', editionScopes,
  unlimited=false, usageDate, quotaLimit, allowClaim=false, grantedAt}) {
  if (!/^\d{6}$/.test(code) || businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) reject(400, 'mobile_stock_read_identity_invalid');
  if (unlimited) return {kind:'test_unlimited', charged:false};
  const slots=editionScopes.map(()=>'?').join(',');
  // Same published score_history pool, date and edition as the target workbench.
  // No independent minute/demo list, top-N membership or client sample flag.
  const dateClause=businessDate ? 'r.data_date=?' : `r.data_date=(SELECT MAX(r2.data_date)
    FROM production_table_rows r2 JOIN production_upload_batches b2 ON b2.batch_id=r2.batch_id
    WHERE r2.table_name='score_history' AND r2.module='target_research'
    AND r2.edition_scope IN (${slots}) AND b2.status='committed'
    AND COALESCE(json_extract(r2.row_json,'$.asset_type'),'stock')='stock')`;
  const sample=await env.DB.prepare(`SELECT r.row_key FROM production_table_rows r
    JOIN production_upload_batches b ON b.batch_id=r.batch_id
    WHERE r.table_name='score_history' AND r.module='target_research'
    AND r.edition_scope IN (${slots}) AND b.status='committed'
    AND COALESCE(json_extract(r.row_json,'$.asset_type'),'stock')='stock'
    AND ${dateClause}
    AND UPPER(COALESCE(json_extract(r.row_json,'$.code'),json_extract(r.row_json,'$.ts_code'),json_extract(r.row_json,'$.symbol'),'')) IN (?,?,?,?) LIMIT 1`)
    .bind(...editionScopes,...(businessDate ? [businessDate] : editionScopes),code,`${code}.SH`,`${code}.SZ`,`${code}.BJ`).first();
  if (sample) return {kind:'sample_pool', charged:false};
  const prior=await env.DB.prepare('SELECT code FROM mobile_stock_read_grants WHERE user_id=? AND usage_date=? AND code=?')
    .bind(user.id,usageDate,code).first();
  if (prior) return {kind:'daily_query', charged:false};
  if (!allowClaim) reject(403,'mobile_stock_read_access_required');
  let saved;
  try {
    saved=await env.DB.prepare(`INSERT INTO mobile_stock_read_grants(user_id,usage_date,code,license_id,quota_limit,granted_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,usage_date,code) DO NOTHING`)
      .bind(user.id,usageDate,code,license.license_id,quotaLimit,grantedAt).run();
  } catch (error) {
    if (String(error.message).includes('mobile_daily_analysis_limit_reached')) reject(429,'mobile_daily_analysis_limit_reached');
    throw error;
  }
  return {kind:'daily_query',charged:Number(saved.meta?.changes)>0};
}
