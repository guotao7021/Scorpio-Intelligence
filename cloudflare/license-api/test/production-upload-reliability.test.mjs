import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/worker.js';
import {__productionUploadMaintenanceTest as upload} from '../src/worker.js';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

test('financial statement tables are explicit market-context upload contracts',()=>{
  for(const table of ['financial_income_statement','financial_cashflow_statement','financial_balance_sheet']) {
    assert.equal(upload.productionUploadTableModule(table),'market_context');
  }
});

function hashDb() {
  const queries = [];
  return {queries, prepare(sql) { return {
    values: [], bind(...values) {
      assert.ok(values.length <= 100, 'D1 parameter budget');
      assert.equal((sql.match(/\?/g) || []).length, values.length);
      this.values = values; return this;
    },
    async all() {
      queries.push(this.values);
      return {results:this.values.slice(2).map(row_key => ({row_key,row_hash:'h'}))};
    },
    async first() { assert.match(sql,/COUNT\(\*\)/); return {n:27367}; },
    async run() { return {success:true}; },
  };}};
}

async function lookup(db, keys, token='test-token') {
  return worker.fetch(new Request('https://example.test/v1/scorpio_v1_admin/production-uploads/row-hashes', {
    method:'POST', headers:{'x-admin-token':token,'content-type':'application/json'},
    body:JSON.stringify({table_name:'fund_profiles',edition_scope:'standard_pro',row_keys:keys}),
  }), {DB:db,ADMIN_API_TOKEN:'test-token',CORS_ALLOWED_ORIGINS:'*'});
}

test('500 hash keys stay within D1 binding budget and cover all keys', async () => {
  const db=hashDb();
  const response=await lookup(db,Array.from({length:500},(_,i)=>String(i)));
  assert.equal(response.status,200);
  assert.equal(Object.keys((await response.json()).rows).length,500);
  assert.equal(db.queries.length,6);
  assert.ok(db.queries.every(q=>q.length<=100));
});

test('full-table equality check exposes scoped row count', async () => {
  const response=await lookup(hashDb(),[]);
  assert.equal(response.status,200);
  assert.equal((await response.json()).table_row_count,27367);
});

test('oversized lookups and unauthenticated lookups are refused', async () => {
  assert.equal((await lookup(hashDb(),Array(501).fill('k'))).status,400);
  assert.equal((await lookup(hashDb(),['k'],'wrong')).status,403);
});

test('dedupe and postcommit readback never count unpublished batch rows as available', async()=>{
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE production_upload_batches(batch_id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE production_table_rows(table_name TEXT,row_key TEXT,row_hash TEXT,edition_scope TEXT,batch_id TEXT);
    INSERT INTO production_upload_batches VALUES('good','committed'),('pending','committing');
    INSERT INTO production_table_rows VALUES('fund_profiles','one','goodhash','standard_pro','good'),('fund_profiles','two','unpublishedhash','standard_pro','pending');`);
  const db={prepare(text){return {values:[],bind(...values){this.values=values;return this;},
    async all(){return {results:sql.prepare(text).all(...this.values)};},
    async first(){return sql.prepare(text).get(...this.values);}};}};
  try{
    let r=await lookup(db,['one','two']);const body=await r.json();
    assert.deepEqual(body.rows,{one:'goodhash'});
    r=await lookup(db,[]);assert.equal((await r.json()).table_row_count,1);
  }finally{sql.close();}
});

function sqliteFixture() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0008_production_uploads.sql','0009_production_upload_staging.sql']) {
    sql.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  }
  const manifest=JSON.stringify({tables:[{table_name:'fund_profiles',mode:'full_replace'}]});
  sql.prepare(`INSERT INTO production_upload_batches (batch_id,module,edition_scope,manifest_json,created_at,updated_at)
    VALUES ('b','target_research','standard_pro',?,'now','now')`).run(manifest);
  const db={failCommit:false,prepare(text) { return {text,values:[],
    bind(...values) {this.values=values;return this;},
    async run() {return sql.prepare(text).run(...this.values);},
  };}, async batch(statements) {
    sql.exec('BEGIN');
    try {
      for (const statement of statements) {
        if (db.failCommit && statement.text.includes("status = 'committed'")) throw new Error('injected failure');
        sql.prepare(statement.text).run(...statement.values);
      }
      sql.exec('COMMIT');
      return statements.map(()=>({success:true}));
    } catch(error) {sql.exec('ROLLBACK');throw error;}
  }};
  return {sql,db,batch:{edition_scope:'standard_pro',manifest_json:manifest}};
}

test('duplicate chunk writes do not double-count cloud receipts',async()=>{
  const {sql,db}=sqliteFixture();
  try {
    const chunk={batch_id:'b',table_name:'fund_profiles',chunk_index:1,chunk_hash:'h',
      edition_scope:'standard_pro',module:'target_research',
      rows:[{row_key:'1',row_hash:'h',row_json:'{}',data_date:'2026-09-18'}]};
    await upload.storeProductionUploadChunk({DB:db},chunk);
    await upload.storeProductionUploadChunk({DB:db},chunk);
    const result=sql.prepare('SELECT received_row_count,received_chunk_count FROM production_upload_batches').get();
    assert.equal(result.received_row_count,1);
    assert.equal(result.received_chunk_count,1);
  } finally {sql.close();}
});

test('publication and receipt roll back together and can be retried',async()=>{
  const {sql,db,batch}=sqliteFixture();
  try {
    sql.exec(`INSERT INTO production_table_rows VALUES ('fund_profiles','old','h','{}','','standard_pro','target_research','old','now');
      INSERT INTO production_upload_staging_rows VALUES ('b','fund_profiles','new','h','{}','','standard_pro','target_research','now');
      UPDATE production_upload_batches SET status='committing';`);
    db.failCommit=true;
    await assert.rejects(()=>upload.commitProductionUploadBatch({DB:db},batch,'b',1,1),/injected failure/);
    assert.equal(sql.prepare('SELECT row_key FROM production_table_rows').get().row_key,'old');
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM production_upload_staging_rows').get().n,1);
    db.failCommit=false;
    await upload.commitProductionUploadBatch({DB:db},batch,'b',1,1);
    assert.equal(sql.prepare('SELECT row_key FROM production_table_rows').get().row_key,'new');
    assert.equal(sql.prepare('SELECT status FROM production_upload_batches').get().status,'committed');
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM production_upload_staging_rows').get().n,0);
    await upload.commitProductionUploadBatch({DB:db},batch,'b',1,1);
    assert.equal(sql.prepare('SELECT row_key FROM production_table_rows').get().row_key,'new', 'late duplicate commit must not erase published rows');
  } finally {sql.close();}
});
