import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {canonical,digest} from '../src/minute-delivery.mjs';
import {loadPlan,buildSql,render} from '../../../scripts/publish_public_data_backfill.mjs';
import {TRAP_CATALOG} from '../src/mobile-trap-catalog.mjs';

async function plan(){
  const day='2026-09-30',r={code:'000027',trade_date:day,interval_minutes:60,data_source:'tushare.stk_mins',price_basis:'unadjusted',
    snapshot_id:'source',available_at:'2026-09-30T15:01:00',quality_status:'complete',updated_at:'2026-09-30T15:01:00',
    bars_json:JSON.stringify(['09:30:00','10:30:00','11:30:00','14:00:00','15:00:00'].map(t=>({bar_time:`${day} ${t}`,open:10,high:11,low:9,close:10,volume:100,amount:1000})))};
  const row_json=canonical(r),entry={row_key:await digest(`stock_hourly_history|${r.code}|${day}`),row_hash:await digest(row_json),row_json,data_date:day};
  return {version:'production-owner-backfill-input.v1',table_name:'stock_hourly_history',module:'market_context',edition_scope:'standard_pro',reference_day:day,
    sample_codes:[],rows:[entry],source_readonly:true,source_write_count:0,inputHash:'a'.repeat(64),
    manifest_json:canonical({module:'market_context',edition_scope:'standard_pro',estimated_rows:1,tables:[{table_name:'stock_hourly_history',mode:'incremental_upsert',retention_month:'2026-10',retained_previous_date:day}]})};
}

test('owner backfill uses normal atomic staging/chunk/commit ledger, never raw research tables',async()=>{
  const p=await plan(),built=await buildSql(p,new Date('2026-10-06T05:00:00Z')),db=new DatabaseSync(':memory:');
  try{
    for(const m of ['0008_production_uploads.sql','0009_production_upload_staging.sql'])db.exec(readFileSync(new URL(`../migrations/${m}`,import.meta.url),'utf8'));
    db.exec('BEGIN;'+built.sql+'COMMIT;');
    assert.equal(db.prepare('SELECT status FROM production_upload_batches').get().status,'committed');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_upload_staging_rows').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_upload_chunks').get().n,1);
    assert.equal(db.prepare('SELECT row_hash FROM production_table_rows').get().row_hash,p.rows[0].row_hash);
    assert.doesNotMatch(built.sql,/stock_minute_bars|stock_minute_features_daily|DELETE FROM accounts/);
    // A repeat cannot reset an already-committed ledger.
    assert.throws(()=>db.exec('BEGIN;'+built.sql+'COMMIT;'),/UNIQUE/);db.exec('ROLLBACK;');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_table_rows').get().n,1);
  }finally{db.close();}
});

test('current-month race aborts the whole owner import; no orphan staging or fabricated receipt',async()=>{
  const p=await plan(),built=await buildSql(p,new Date('2026-10-06T05:00:00Z')),db=new DatabaseSync(':memory:');
  try{
    for(const m of ['0008_production_uploads.sql','0009_production_upload_staging.sql'])db.exec(readFileSync(new URL(`../migrations/${m}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO production_upload_batches(batch_id,module,status,created_at,updated_at) VALUES('current','market_context','committed','now','now')");
    db.prepare('INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)').run('stock_hourly_history','current','h',JSON.stringify({quality_status:'complete',available_at:'2026-10-01T15:01:00'}),'2026-10-01','standard_pro','market_context','current','now');
    assert.throws(()=>db.exec('BEGIN;'+built.sql+'COMMIT;'),/NOT NULL/);db.exec('ROLLBACK;');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_upload_batches').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_upload_staging_rows').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_table_rows').get().n,1);
  }finally{db.close();}
});

test('owner source seal rejects data damage, wrong table and private fields',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'backfill-test-'));
  try{
    const {inputHash,...p}=await plan();
    async function file(value){const payload_json=canonical(value),f=path.join(directory,'source.json');
      writeFileSync(f,canonical({version:'production-owner-backfill-file.v1',payload_json,content_hash:await digest(payload_json)}));return f;}
    assert.equal((await loadPlan(await file(p))).rows.length,1);
    for(const changed of [{...p,table_name:'stock_minute_bars'},{...p,source_write_count:1},
      {...p,rows:[{...p.rows[0],row_json:'{}'}]}])await assert.rejects(()=>file(changed).then(loadPlan));
    assert.throws(()=>render('SELECT ?,?',['x']));
    assert.equal(render('SELECT ?',["';DROP TABLE test;--"]),"SELECT ''';DROP TABLE test;--';");
  }finally{rmSync(directory,{recursive:true,force:true});}
});


test('signal owner upload preserves all 22 states and prevents stale-day atomic commits',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'signal-owner-test-'));
  const db=new DatabaseSync(':memory:');
  try {
    const day='2026-10-30',hash='sha256:'+'a'.repeat(64);
    const unsigned={version:'mobile-stock-signals.v1',code:'000001',business_date:day,batch_id:'SCB-'+'b'.repeat(32),
      source_hash:hash,input_revision_hash:hash,policy_hash:hash,known_at:'2026-10-31T15:00:00+08:00',
      display_only:true,orders_authorized:false,production_release_authorized:false,
      rules:TRAP_CATALOG.map(r=>({rule_id:r.id,implementation:r.implemented?'implemented':'deferred',
        data_status:r.implemented?'complete':'missing',calibration_status:'unvalidated_research',
        assessment:r.implemented?'not_triggered':'not_assessed'}))};
    const snapshot={...unsigned,content_hash:'sha256:'+await digest(canonical(unsigned))};
    const row={code:'000001',business_date:day,batch_id:snapshot.batch_id,snapshot_json:canonical(snapshot),updated_at:snapshot.known_at};
    const table_name='stock_signal_observation_daily',module='market_context',edition_scope='standard_pro';
    const row_json=canonical(row),p={version:'production-owner-backfill-input.v1',table_name,module,edition_scope,
      reference_day:day,sample_codes:['000001'],source_readonly:true,source_write_count:0,
      manifest_json:canonical({module,edition_scope,estimated_rows:1,tables:[{table_name,mode:'incremental_upsert'}]}),
      rows:[{row_key:await digest(`${table_name}|${day}|000001`),row_hash:await digest(row_json),row_json,data_date:day}]};
    const file=path.join(dir,'plan.json');
    async function load(value) {const payload_json=canonical(value);writeFileSync(file,canonical({version:'production-owner-backfill-file.v1',payload_json,content_hash:await digest(payload_json)}));return loadPlan(file);}
    const valid=await load(p),built=await buildSql(valid);
    for(const m of ['0008_production_uploads.sql','0009_production_upload_staging.sql'])db.exec(readFileSync(new URL(`../migrations/${m}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO production_upload_batches(batch_id,module,status,created_at,updated_at) VALUES('current','target_research','committed','now','now')");
    db.prepare('INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)').run('score_history','fixture','h','{"code":"000001","asset_type":"stock"}','2026-10-29','standard_pro','target_research','current','now');
    assert.throws(()=>db.exec('BEGIN;'+built.sql+'COMMIT;'),/NOT NULL/);db.exec('ROLLBACK;');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_upload_batches').get().n,1);
    db.prepare("UPDATE production_table_rows SET data_date=? WHERE table_name='score_history'").run(day);
    db.exec('BEGIN;'+built.sql+'COMMIT;');
    const served=JSON.parse(db.prepare('SELECT row_json FROM production_table_rows WHERE table_name=?').get(table_name).row_json);
    assert.deepEqual(JSON.parse(served.snapshot_json).rules,snapshot.rules);
    await assert.rejects(()=>load({...p,sample_codes:[]}));
    const privateRow=canonical({...row,private_account:{quantity:100}});
    const privateHash=await digest(privateRow);
    await assert.rejects(()=>load({...p,rows:[{...p.rows[0],row_json:privateRow,row_hash:privateHash}]}));
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});


test('stock master publication uses normal full replacement and preserves other edition scopes',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'board-master-test-')),db=new DatabaseSync(':memory:');
  try {
    const table_name='stock_info',module='target_research',edition_scope='standard_pro';
    const row={code:'000001',name:'样例',market:'深圳证券交易所',updated_at:'2026-10-27',listing_board:'主板',
      listing_board_source:'bq_stock_basic_info.security_type',listing_board_available_on:'2026-05-19',listing_board_source_hash:'sha256:'+'a'.repeat(64)};
    const row_json=canonical(row),payload={version:'production-owner-backfill-input.v1',table_name,module,edition_scope,
      reference_day:'2026-10-30',sample_codes:['000001'],source_readonly:true,source_write_count:0,
      manifest_json:canonical({module,edition_scope,estimated_rows:1,tables:[{table_name,mode:'full_replace'}]}),
      rows:[{row_key:await digest('stock_info|000001'),row_hash:await digest(row_json),row_json,data_date:row.updated_at}]};
    const payload_json=canonical(payload),file=path.join(dir,'source.json');
    writeFileSync(file,canonical({version:'production-owner-backfill-file.v1',payload_json,content_hash:await digest(payload_json)}));
    const plan=await loadPlan(file),built=await buildSql(plan);
    for(const m of ['0008_production_uploads.sql','0009_production_upload_staging.sql'])db.exec(readFileSync(new URL(`../migrations/${m}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO production_upload_batches(batch_id,module,status,created_at,updated_at) VALUES('before','target_research','committed','now','now')");
    const insert=db.prepare('INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)');
    insert.run(table_name,'keep','h','{}','2026-10-27','pro',module,'before','now');
    insert.run(table_name,'replace','h','{}','2026-10-27',edition_scope,module,'before','now');
    db.exec('BEGIN;'+built.sql+'COMMIT;');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM production_table_rows WHERE edition_scope='pro'").get().n,1);
    const actual=db.prepare("SELECT row_json FROM production_table_rows WHERE edition_scope='standard_pro'").all();
    assert.equal(actual.length,1);assert.deepEqual(JSON.parse(actual[0].row_json),row);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});


test('large signal snapshots are split before inline SQL exceeds D1 UTF-8 statement limits',async()=>{
  const day='2026-10-30',rows=[];
  for(let i=0;i<40;i++) {
    const code=String(i+1).padStart(6,'0');
    const row={code,business_date:day,batch_id:'SCB-'+'b'.repeat(32),updated_at:'2026-11-01T01:00:00+08:00',
      snapshot_json:canonical({version:'mobile-stock-signals.v1',code,business_date:day,
        batch_id:'SCB-'+'b'.repeat(32),source_hash:'sha256:'+'a'.repeat(64),input_revision_hash:'sha256:'+'c'.repeat(64),
        policy_hash:'sha256:'+'d'.repeat(64),known_at:'2026-11-01T01:00:00+08:00',display_only:true,
        orders_authorized:false,production_release_authorized:false,
        rules:TRAP_CATALOG.map(r=>({rule_id:r.id,implementation:r.implemented?'implemented':'deferred',
          data_status:r.implemented?'complete':'missing',calibration_status:'unvalidated_research',
          assessment:r.implemented?'not_triggered':'not_assessed'}))})};
    const row_json=canonical(row);
    rows.push({row_key:await digest('stock_signal_observation_daily|'+day+'|'+code),row_hash:await digest(row_json),row_json,data_date:day});
  }
  const p={table_name:'stock_signal_observation_daily',module:'market_context',edition_scope:'standard_pro',
    inputHash:'a'.repeat(64),reference_day:day,rows,
    manifest_json:canonical({module:'market_context',edition_scope:'standard_pro',tables:[{table_name:'stock_signal_observation_daily',mode:'incremental_upsert'}]})};
  const built=await buildSql(p);
  assert.ok(built.chunks>1);
  const db=new DatabaseSync(':memory:');
  try {
    for(const m of ['0008_production_uploads.sql','0009_production_upload_staging.sql'])db.exec(readFileSync(new URL(`../migrations/${m}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO production_upload_batches(batch_id,module,status,created_at,updated_at) VALUES('sample','target_research','committed','now','now')");
    db.prepare('INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)').run('score_history','sample','h','{"code":"000001","asset_type":"stock"}',day,'standard_pro','target_research','sample','now');
    db.exec('BEGIN;'+built.sql+'COMMIT;');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM production_table_rows WHERE table_name='stock_signal_observation_daily'").get().n,40);
  }finally{db.close();}
});
