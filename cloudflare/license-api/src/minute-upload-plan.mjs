/** Admin-only upload planning/readback. No raw SQL, source data or user grants. */
import {readBetaPublication} from './minute-beta-direct.mjs';
import {wallTime} from './minute-delivery.mjs';
import {readMarketMinuteObservation} from './market-minute-observation.mjs';

function check(ok, message, status=400) {
  if (!ok) throw Object.assign(new Error(message), {status, publicMessage:message});
}
const sampleWhere = `r.table_name='score_history' AND r.module='target_research'
  AND b.status='committed' AND r.edition_scope IN ('standard','pro','standard_pro')
  AND COALESCE(json_extract(r.row_json,'$.asset_type'),'stock')='stock'`;

export async function minuteUploadPlan(env, body, _actor, now=new Date()) {
  check(env.MINUTE_BETA_DIRECT_ENABLED==='1', 'minute_beta_disabled',403);
  check(body && typeof body==='object' && !Array.isArray(body) &&
    Object.keys(body).every(k=>['business_date','verify_codes','verify_market'].includes(k)), 'minute_upload_plan_invalid');
  check(body.verify_market===undefined || typeof body.verify_market==='boolean', 'minute_upload_plan_invalid');
  const latest=await env.DB.prepare(`SELECT MAX(r.data_date) AS day FROM production_table_rows r
    JOIN production_upload_batches b ON b.batch_id=r.batch_id WHERE ${sampleWhere}`).first();
  const day=body.business_date || latest?.day;
  if (!day) return {status:'no_public_sample', business_date:null, sample_codes:[], heads:[], verified:[]};
  check(/^\d{4}-\d{2}-\d{2}$/.test(day) && wallTime(day+'T15:00:00')<=now.getTime(), 'minute_upload_date_invalid');
  check(day===latest.day, 'minute_upload_sample_date_changed',409);
  const market=await env.DB.prepare(`SELECT MAX(r.data_date) AS day FROM production_table_rows r
    JOIN production_upload_batches b ON b.batch_id=r.batch_id WHERE r.table_name='market_score_daily'
    AND b.status='committed' AND r.edition_scope IN ('standard','pro','standard_pro')`).first();
  check(market?.day===day, 'minute_upload_market_date_not_aligned',409);
  const sample=await env.DB.prepare(`SELECT DISTINCT substr(UPPER(json_extract(r.row_json,'$.code')),1,6) AS code
    FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
    WHERE ${sampleWhere} AND r.data_date=? ORDER BY code LIMIT 1001`).bind(day).all();
  const scoredCodes=sample.results.map(r=>r.code);
  check(scoredCodes.length && scoredCodes.length<=1000 && scoredCodes.every(c=>/^\d{6}$/.test(c)), 'minute_upload_sample_invalid');
  // score_history is an archive, not the current publishable universe. Only
  // explicit delisted status from the committed public pool excludes a code;
  // unknown/missing membership must never silently hide a real data gap.
  const inactive=await env.DB.prepare(`SELECT DISTINCT substr(UPPER(json_extract(r.row_json,'$.code')),1,6) AS code
    FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
    WHERE r.table_name='stock_analysis_pool' AND b.status='committed'
    AND r.edition_scope IN ('standard','pro','standard_pro')
    AND LOWER(json_extract(r.row_json,'$.status'))='delisted'`).all();
  const excluded=new Set(inactive.results.map(r=>r.code));
  const excluded_samples=scoredCodes.filter(c=>excluded.has(c)).map(code=>({code,reason:'current_pool_delisted'}));
  const codes=scoredCodes.filter(c=>!excluded.has(c));
  if (!codes.length) return {status:'no_public_sample',business_date:day,sample_codes:[],heads:[],verified:[],excluded_samples};
  const result=await env.DB.prepare(`SELECT p.code,p.publication_id,p.generated_at,
    json_extract(p.envelope_json,'$.expires_at') AS expires_at,
    json_extract(p.policy_json,'$.edition_scopes') AS edition_scopes,r.publication_id AS revoked_id,
    (SELECT group_concat(h,':') FROM (SELECT json_extract(value,'$.content_hash') AS h
      FROM json_each(p.envelope_json,'$.packs') ORDER BY h)) AS packs_signature
    FROM minute_beta_publications p LEFT JOIN minute_beta_revocations r ON r.publication_id=p.publication_id
    WHERE p.business_date=? AND p.seq=(SELECT MAX(h.seq) FROM minute_beta_publications h
      WHERE h.code=p.code AND h.business_date=p.business_date) ORDER BY p.code LIMIT 1001`).bind(day).all();
  const verify=body.verify_codes || [];
  check(Array.isArray(verify) && verify.length<=5 && new Set(verify).size===verify.length &&
    verify.every(c=>codes.includes(c)), 'minute_upload_verify_invalid');
  const verified=[];
  for (const code of verify) {
    const envelope=await readBetaPublication(env,{code,businessDate:day,
      editionScopes:['standard','pro','standard_pro'],clientVersion:'0.3.0-beta.23'},now);
    verified.push({code,status:envelope.status,publication_id:envelope.publication_id || '',
      packs_signature:(envelope.packs || []).map(p=>p.content_hash).sort().join(':'),
      market_points:(envelope.packs || []).map(p=>JSON.parse(p.payload_json))
        .find(p=>p.scope==='market')?.market_session?.points.length || 0});
  }
  let marketReadback;
  if (body.verify_market) {
    const value=await readMarketMinuteObservation(env,{businessDate:day,
      editionScopes:['standard','pro','standard_pro'],clientVersion:'0.3.0-beta.23'},now);
    marketReadback={status:value.status,publication_id:value.publication_id || '',
      points:value.session?.points.length || 0};
  }
  return {status:'ready',business_date:day,sample_codes:codes,
    heads:result.results.filter(r=>codes.includes(r.code)),verified,excluded_samples,
    ...(marketReadback ? {market_readback:marketReadback} : {})};
}
