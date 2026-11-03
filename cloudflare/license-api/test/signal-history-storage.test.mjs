import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {archiveSignalPrefix,readSignalArchive,attestLocalArchive,pruneSignalArchive,
  signalStoragePlan,assertUploadStorageBudget,SIGNAL_TABLE} from '../src/signal-history-storage.mjs';

function fixture() {
  const db=new DatabaseSync(':memory:'), objects=new Map();
  db.exec(readFileSync(new URL('../migrations/0031_signal_history_archives.sql',import.meta.url),'utf8'));
  db.exec(`CREATE TABLE production_upload_batches(batch_id TEXT PRIMARY KEY,status TEXT,committed_at TEXT);
    CREATE TABLE production_table_rows(table_name TEXT,row_key TEXT,row_hash TEXT,row_json TEXT,data_date TEXT,
      edition_scope TEXT,module TEXT,batch_id TEXT,updated_at TEXT,PRIMARY KEY(table_name,row_key,edition_scope));
    INSERT INTO production_upload_batches VALUES('complete','committed','2026-11-03');`);
  const env={used:4100000000,RELEASE_BUCKET:{
    get:async key=>objects.has(key)?{arrayBuffer:async()=>objects.get(key).slice().buffer}:null,
    put:async(key,bytes)=>{if(!objects.has(key))objects.set(key,new Uint8Array(bytes));}},
    DB:{prepare(sql){const args=[];const statement={
      bind(...values){args.push(...values);return statement;},
      first:async()=>db.prepare(sql).get(...args)||null,
      all:async()=>({results:db.prepare(sql).all(...args),meta:{size_after:env.used}}),
      run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})};return statement;},
      batch:async items=>{db.exec('BEGIN');try{const r=[];for(const item of items)r.push(await item.run());db.exec('COMMIT');return r;}
        catch(e){db.exec('ROLLBACK');throw e;}}}};
  function row(table,day,code='000001',prefix='a',hash='producer-independent-business-hash') {
    const snapshot={version:'mobile-stock-signals.v1',code,business_date:day,display_only:true,
      orders_authorized:false,production_release_authorized:false};
    const payload=table===SIGNAL_TABLE?{batch_id:'original',business_date:day,code,snapshot_json:JSON.stringify(snapshot),updated_at:'original-clock'}:
      {symbol:code,trade_date:day,value:1};
    const r={table_name:table,row_key:prefix+day+code,row_hash:hash,row_json:JSON.stringify(payload),data_date:day,
      edition_scope:'standard_pro',module:'market_context',batch_id:'complete',updated_at:'original-updated-clock'};
    db.prepare('INSERT OR REPLACE INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(r));return r;
  }
  const partition=(table=SIGNAL_TABLE,day='2026-10-01')=>({table_name:table,edition_scope:'standard_pro',data_date:day,key_prefix:'a',dry_run:false});
  const proof=async a=>{const {receipt}=await readSignalArchive(env,a.archive_id);
    await attestLocalArchive(env,{archive_id:a.archive_id,gzip_hash:receipt.gzip_hash,raw_hash:receipt.raw_hash,
      gzip_bytes:receipt.gzip_bytes,row_count:receipt.row_count,local_readback_verified:true});
    return {local_copy_hash:receipt.gzip_hash,completed_batch_id:'complete',unified_upload_completed:true};};
  function newer(table=SIGNAL_TABLE,n=5) {for(let i=1;i<=n;i++)row(table,`2026-${i<30?'10':'11'}-${String(i<30?i+1:i-29).padStart(2,'0')}`);}
  return {db,env,objects,row,partition,proof,newer};
}

test('archive retries are lossless, immutable and counted once; hashes preserve producer identity',async()=>{
  const f=fixture();try{
    const original=f.row(SIGNAL_TABLE,'2026-10-01');
    const a=await archiveSignalPrefix(f.env,f.partition());
    const b=await archiveSignalPrefix(f.env,f.partition());
    assert.equal(a.archive_id,b.archive_id);assert.equal(f.objects.size,1);
    assert.deepEqual((await readSignalArchive(f.env,a.archive_id)).pack.rows,[original]);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_signal_archives').get().n,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_table_rows').get().n,1);
  }finally{f.db.close();}
});
test('cold delete requires local proof, successful upload and capacity pressure; hot days survive',async()=>{
  const f=fixture();try{
    f.row(SIGNAL_TABLE,'2026-10-01');const a=await archiveSignalPrefix(f.env,f.partition());
    await assert.rejects(pruneSignalArchive(f.env,a.archive_id),/local_copy_proof/);
    const proof=await f.proof(a);
    await assert.rejects(pruneSignalArchive(f.env,a.archive_id,{...proof,unified_upload_completed:false}),/completed_upload/);
    await assert.rejects(pruneSignalArchive(f.env,a.archive_id,proof),/hot_day/);
    f.newer();f.env.used=3000000000;
    await assert.rejects(pruneSignalArchive(f.env,a.archive_id,proof),/no_budget_pressure/);
    f.env.used=4100000000;
    assert.equal((await pruneSignalArchive(f.env,a.archive_id,proof)).deleted_rows,1);
    assert.equal((await pruneSignalArchive(f.env,a.archive_id,proof)).deleted_rows,0);
    assert.equal((await readSignalArchive(f.env,a.archive_id)).pack.rows.length,1);
  }finally{f.db.close();}
});
test('sparse stock fallback, concurrent revised bytes and active uploads cannot be removed',async()=>{
  const f=fixture();try{
    f.row(SIGNAL_TABLE,'2026-10-01','000001');f.row(SIGNAL_TABLE,'2026-10-01','000002');f.row(SIGNAL_TABLE,'2026-10-01','000003');
    const a=await archiveSignalPrefix(f.env,f.partition()),proof=await f.proof(a);f.newer();
    f.row(SIGNAL_TABLE,'2026-10-02','000003');f.row(SIGNAL_TABLE,'2026-10-01','000003','a','revised');
    f.db.prepare('INSERT INTO production_upload_batches VALUES(?,?,?)').run('uploading','receiving','');
    await assert.rejects(pruneSignalArchive(f.env,a.archive_id,proof),/active_upload/);
    f.db.prepare("UPDATE production_upload_batches SET status='aborted' WHERE batch_id='uploading'").run();
    assert.equal((await pruneSignalArchive(f.env,a.archive_id,proof)).deleted_rows,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM production_table_rows WHERE data_date='2026-10-01'").get().n,2);
  }finally{f.db.close();}
});
test('missing/corrupt R2 object and false local-copy hash fail closed',async()=>{
  const f=fixture();try{
    f.row(SIGNAL_TABLE,'2026-10-01');const a=await archiveSignalPrefix(f.env,f.partition());
    await assert.rejects(attestLocalArchive(f.env,{archive_id:a.archive_id,local_readback_verified:true}),/local_copy_proof/);
    const bytes=f.objects.get(a.r2_key);f.objects.delete(a.r2_key);
    await assert.rejects(readSignalArchive(f.env,a.archive_id),/object_missing/);
    f.objects.set(a.r2_key,new Uint8Array(bytes.length));
    await assert.rejects(readSignalArchive(f.env,a.archive_id),/gzip_hash/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_table_rows').get().n,1);
  }finally{f.db.close();}
});
test('R2 reservation cap and D1 unknown/hard budget block new work; private tables rejected',async()=>{
  const f=fixture();try{
    f.row(SIGNAL_TABLE,'2026-10-01');
    await assert.rejects(archiveSignalPrefix(f.env,{...f.partition(),table_name:'users'}),/table_not_allowed/);
    f.env.D1_STORAGE_HARD_BYTES=4200000000;await assert.rejects(assertUploadStorageBudget(f.env,30000000),/budget_exceeded/);
    f.env.used=null;await assert.rejects(assertUploadStorageBudget(f.env),/measurement_unavailable/);
    f.env.used=4100000000;f.env.SIGNAL_ARCHIVE_BUDGET_BYTES=1000000;
    f.db.prepare(`INSERT INTO production_signal_archives VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'reserved','stock_daily_latest','standard_pro','2026-10-01','b',1,1000000,1000000,'raw','gzip','reserved','pending','','','',0);
    await assert.rejects(archiveSignalPrefix(f.env,f.partition()),/budget_or_identity/);
    assert.equal(f.objects.size,0);
  }finally{f.db.close();}
});
test('OHLC keeps 60 sessions per asset; latest/risk and all global hot days protected',async()=>{
  const f=fixture();try{
    for(const table of ['stock_daily_ohlcv','stock_daily_latest','stock_risk_metrics']){
      f.row(table,'2026-08-01');f.row(table,'2026-08-01','000002');
      for(let i=0;i<62;i++)f.row(table,new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10));
      const a=await archiveSignalPrefix(f.env,f.partition(table,'2026-08-01')),proof=await f.proof(a);
      assert.equal((await pruneSignalArchive(f.env,a.archive_id,proof)).deleted_rows,1);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_table_rows WHERE table_name=? AND data_date=?').get(table,'2026-08-01').n,1);
    }
    const plan=await signalStoragePlan(f.env);assert.equal(plan.automatic_deletion,false);assert.equal(plan.deletion_scope.length,4);
  }finally{f.db.close();}
});

test('source-specific sparse history survives another source newer coverage',async()=>{
  const f=fixture();try{
    f.row('stock_daily_ohlcv','2026-08-01');
    f.db.prepare("UPDATE production_table_rows SET row_json=json_set(row_json,'$.data_source','sparse-source')").run();
    for(let i=0;i<62;i++)f.row('stock_daily_ohlcv',new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10));
    const a=await archiveSignalPrefix(f.env,f.partition('stock_daily_ohlcv','2026-08-01'));
    assert.equal((await pruneSignalArchive(f.env,a.archive_id,await f.proof(a))).deleted_rows,0);
  }finally{f.db.close();}
});

test('admin routes require auth; real HTTP chunk path checks capacity before staging and preserves retries',async()=>{
  const f=fixture();try{
    const response=await worker.fetch(new Request('https://test.invalid/v1/scorpio_v1_admin/storage-budget/plan',{method:'POST',body:'{}'}),
      {...f.env,ADMIN_API_TOKEN:'test'});
    assert.equal(response.status,403);
  }finally{f.db.close();}
  let staged=false,duplicate=false;
  const env={ADMIN_API_TOKEN:'test',DB:{prepare(sql){return {
    bind(){return this;},
    first:async()=>sql.includes('SELECT * FROM production_upload_batches')?{status:'receiving',edition_scope:'standard_pro'}:
      duplicate&&sql.includes('production_upload_chunks')?{row_count:1,chunk_hash:'same'}:null,
    all:async()=>({results:[],meta:{}}),
    run:async()=>{if(sql.includes('production_upload_staging_rows'))staged=true;return {success:true};}};},batch:async()=>{staged=true;}}};
  const body={batch_id:'test',table_name:'stock_daily_latest',edition_scope:'standard_pro',chunk_hash:'same',rows:[{row_key:'a',row_hash:'h',data_date:'2026-11-02',row:{symbol:'000001'}}]};
  const request=()=>new Request('https://test.invalid/v1/scorpio_v1_admin/production-uploads/chunks',{
    method:'POST',headers:{'x-admin-token':'test'},body:JSON.stringify(body)});
  let response=await worker.fetch(request(),env);
  assert.equal(response.status,409);assert.match((await response.json()).error,/storage_measurement_unavailable/);assert.equal(staged,false);
  duplicate=true;response=await worker.fetch(request(),env);
  assert.equal(response.status,200);assert.equal((await response.json()).duplicate,true);assert.equal(staged,false);
});
