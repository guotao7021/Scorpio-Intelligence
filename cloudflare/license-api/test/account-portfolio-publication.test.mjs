import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import worker,{__mobilePresentationTest as view,__productionUploadMaintenanceTest as upload} from '../src/worker.js';

function fixture(){
  const db=new DatabaseSync(':memory:');const binds=[];
  db.exec(`CREATE TABLE production_upload_batches(batch_id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE production_table_rows(table_name TEXT,row_key TEXT,row_hash TEXT,row_json TEXT,data_date TEXT,
      edition_scope TEXT,module TEXT,batch_id TEXT,updated_at TEXT,PRIMARY KEY(table_name,row_key,edition_scope));
    INSERT INTO production_upload_batches VALUES('ready','committed'),('pending','staging');`);
  const env={DB:{prepare(sql){return {bind(...values){binds.push(values.length);assert.ok(values.length<=100);
    return {all:async()=>({results:db.prepare(sql).all(...values)})};}}}}};
  function add(table,code,row={},scope='pro',batch='ready',day='2026-11-02'){
    const data={ts_code:code,trade_date:day,...row};db.prepare('INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)')
      .run(table,`${code}:${day}`,code,JSON.stringify(data),day,scope,upload.productionUploadTableModule(table),batch,'2026-11-02T20:00:00Z');
  }
  return {db,env,binds,add};
}

test('account quotes use committed edition-scoped exact instruments and unit NAV only',async()=>{
  const {db,env,add}=fixture();try{
    add('stock_daily_latest','600000.SH',{close:12});
    add('stock_info','600000.SH',{name:'正式名称',industry:'银行',listing_board_label:'主板'});
    add('stock_daily_latest','600000.SH',{close:999},'institutional');
    add('stock_daily_latest','000001.SZ',{close:999},'pro','pending');
    add('fund_nav_daily','000001',{unit_nav:1.25,acc_nav:8});
    add('fund_nav_daily','000002',{acc_nav:8});
    const positions=[{asset_type:'stock',code:'600000'}, {asset_type:'stock',code:'000001'},
      {asset_type:'fund',code:'000001'},{asset_type:'fund',code:'000002'}];
    const facts=await view.loadMobileAccountFacts({env},{edition:'personal_pro'},positions);
    assert.equal(facts.find(p=>p.instrument_id==='CN:stock:600000').price,12);
    assert.equal(facts.find(p=>p.instrument_id==='CN:stock:600000').name,'正式名称');
    assert.equal(facts.find(p=>p.instrument_id==='CN:stock:000001'),undefined);
    assert.equal(facts.find(p=>p.instrument_id==='CN:fund:000001').price,1.25);
    const missing=facts.find(p=>p.instrument_id==='CN:fund:000002');
    assert.equal(missing.price,undefined);assert.equal(missing.quality,'unavailable');
    assert.equal(facts.find(p=>p.instrument_id==='CN:stock:600000').industry,'银行');
  }finally{db.close();}
});

test('full 200-item account keeps bounded SQL binds and does not upload private state as research',async()=>{
  const {db,env,binds,add}=fixture();try{
    const positions=Array.from({length:200},(_,i)=>({asset_type:'stock',code:String(600000+i)}));
    positions.forEach(p=>add('stock_daily_latest',p.code+'.SH',{close:10}));
    const facts=await view.loadMobileAccountFacts({env},{edition:'personal_pro'},positions);
    assert.equal(facts.length,200);assert.ok(Math.max(...binds)<=100);
    for(const table of ['mobile_account_portfolios','mobile_account_portfolio_revisions','mobile_account_portfolio_plans'])
      assert.equal(upload.productionUploadTableModule(table),'');
  }finally{db.close();}
});

test('actual registered account endpoints require authentication before reading any portfolio table',async()=>{
  for(const action of ['query','snapshot','scenario','plans','history']){
    const response=await worker.fetch(new Request('https://api.invalid/v2/mobile/portfolio/'+action,
      {method:action==='snapshot'?'PUT':'POST',headers:{'content-type':'application/json'},body:'{}'}),{});
    assert.equal(response.status,401);assert.match((await response.json()).error,/authorization|authentication|token|unauthorized/);
  }
});
