import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {canonical,digest} from '../src/minute-delivery.mjs';
import {loadPlan,buildSql,verifiedCommitChunks} from '../../../scripts/publish_public_data_backfill.mjs';
import {__mobilePresentationTest as mobile} from '../src/worker.js';

const day='2026-10-30',known='2026-11-02T06:00:00+08:00';
function fact(changes={}) {
  return {trade_date:day,symbol:'600036',data_source:'derived_daily_bar',
    volatility_20:0,volatility_60:0,max_drawdown_20:0,max_drawdown_60:0,
    extreme_down_days_20:0,avg_turnover_20:null,liquidity_amount_20:0,liquidity_amount_unit:'CNY',risk_score:50,
    created_at:known,updated_at:known,available_at:known,sample_count_20:20,sample_count_60:60,
    risk_formula_version:'daily-price-pressure.v1',quality_policy_version:'complete-sse-periods-cny-turnover.v2',
    source_window_hash:'sha256:'+'a'.repeat(64),price_basis:'unadjusted',calendar_source:'tushare_trade_calendar.SSE',
    metric_status:'partial',missing_metrics_json:'["turnover_20_incomplete"]',turnover_unit:null,turnover_source:null,...changes};
}
async function file(dir,r) {
  const table_name='stock_risk_metrics',row_json=canonical(r),row_hash=await digest(row_json),
    row_key=await digest(`${table_name}|${r.trade_date}|${r.symbol}|${r.data_source}`);
  const derivation={version:'daily-price-risk-refresh.v1',business_date:day,available_at:known,
    source_hash:'sha256:'+await digest(canonical([[r.symbol,r.source_window_hash]])),
    result_hash:'sha256:'+await digest(canonical([r])),calendar_hash:'sha256:'+'c'.repeat(64),
    upload_rows_hash:'sha256:'+await digest(canonical([[row_key,row_hash]])),scored_rows:r.risk_score===null?0:1};
  const payload_json=canonical({version:'production-owner-backfill-input.v1',table_name,module:'market_context',
    edition_scope:'standard_pro',reference_day:day,sample_codes:['600036'],source_readonly:true,source_write_count:0,
    rows:[{row_key,row_hash,row_json,data_date:r.trade_date}],
    manifest_json:canonical({module:'market_context',edition_scope:'standard_pro',estimated_rows:1,derivation,
      tables:[{table_name,mode:'incremental_upsert'}]})});
  const target=path.join(dir,'plan.json');
  writeFileSync(target,canonical({version:'production-owner-backfill-file.v1',payload_json,content_hash:await digest(payload_json)}));
  return target;
}
function database() {
  const db=new DatabaseSync(':memory:');
  for(const name of ['0008_production_uploads.sql','0009_production_upload_staging.sql'])
    db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  db.exec("INSERT INTO production_upload_batches(batch_id,module,status,created_at,updated_at) VALUES('old','market_context','committed','old','old')");
  return db;
}

test('separately prepared risk facts use the normal commit ledger and formal mobile reader',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'price-risk-')),db=database();
  try {
    db.prepare('INSERT INTO production_table_rows VALUES (?,?,?,?,?,?,?,?,?)')
      .run('stock_risk_metrics','old-row','old-hash',canonical(fact({trade_date:'2026-10-23'})),
        '2026-10-23','standard_pro','market_context','old','old');
    const built=await buildSql(await loadPlan(await file(dir,fact())));
    db.exec('BEGIN;'+built.sql+'COMMIT;');
    assert.equal(db.prepare('SELECT count(*) n FROM production_table_rows').get().n,2);
    assert.equal(db.prepare('SELECT count(*) n FROM production_upload_staging_rows').get().n,0);
    assert.equal(db.prepare('SELECT status FROM production_upload_batches WHERE batch_id=?').get(built.batch_id).status,'committed');
    const env={DB:{prepare(sql){return {bind(...args){return {
      async all(){return {results:db.prepare(sql).all(...args)};},
      async first(){return db.prepare(sql).get(...args)||null;},
    };}};}}};
    const rows=await mobile.publishedRowsForCode(env,'stock_risk_metrics',{edition:'personal_pro'},'600036',1,{as_of_date:day});
    assert.equal(rows.length,1);assert.equal(rows[0].trade_date,day);
    const portrait=mobile.mobileStockResearchPayload({sections:{risk_metrics:rows[0]}},{},
      {code:'600036',data_date:day,market:'CN'},{}).risk_portrait;
    assert.equal(portrait.groups.find(g=>g.scope==='stock').score,50);
    assert.equal(portrait.dimensions.find(d=>d.id==='price').items.length,2);
    assert.equal(portrait.dimensions.find(d=>d.id==='volatility').items.length,3);
    assert.equal(portrait.dimensions.find(d=>d.id==='liquidity').items[0].numeric_value,0);
    assert.ok(!portrait.dimensions.find(d=>d.id==='liquidity').items.some(i=>i.metric_id==='avg_turnover_20'));
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('risk publisher rejects fabricated scores, unit guesses, incomplete windows and private fields',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'price-risk-invalid-'));
  try {
    for(const changes of [{risk_score:51},{liquidity_amount_unit:'千元'},
      {sample_count_60:59},{volatility_20:null},{created_at:day+'T15:00:00+08:00'},
      {private_account:{quantity:100}},{max_drawdown_20:-2},{missing_metrics_json:'[]'},
      {trade_date:'2026-10-29'},{risk_score:0,volatility_20:null}])
      await assert.rejects(()=>file(dir,fact(changes)).then(loadPlan));
    const accepted=await loadPlan(await file(dir,fact({volatility_20:null,risk_score:null,
      extreme_down_days_20:null,missing_metrics_json:'["turnover_20_incomplete","pct_change_20_incomplete"]'})));
    assert.equal(JSON.parse(accepted.rows[0].row_json).risk_score,null);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('a newer same-day risk publication aborts the complete owner import without changing history',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'price-risk-race-')),db=database();
  try {
    const newer=fact({available_at:'2026-11-02T07:00:00+08:00'});
    db.prepare('INSERT INTO production_table_rows VALUES (?,?,?,?,?,?,?,?,?)')
      .run('stock_risk_metrics','newer','hash',canonical(newer),day,'standard_pro','market_context','old','old');
    const built=await buildSql(await loadPlan(await file(dir,fact())));
    assert.throws(()=>db.exec('BEGIN;'+built.sql+'COMMIT;'),/NOT NULL/);db.exec('ROLLBACK;');
    assert.equal(db.prepare('SELECT count(*) n FROM production_upload_batches').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM production_upload_staging_rows').get().n,0);
    assert.equal(db.prepare('SELECT row_key FROM production_table_rows').get().row_key,'newer');
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('verified committed chunks survive a changed owner rendering budget without resetting a batch',()=>{
  const r={status:'committed',received_row_count:5846,received_chunk_count:12,actual_chunk_count:12,staging_rows:0};
  assert.equal(verifiedCommitChunks(r,5846,48,{reused:true}),12);
  assert.throws(()=>verifiedCommitChunks(r,5846,48));
  assert.throws(()=>verifiedCommitChunks({...r,actual_chunk_count:11},5846,48,{reused:true}));
  assert.throws(()=>verifiedCommitChunks({...r,staging_rows:1},5846,48,{reused:true}));
});
