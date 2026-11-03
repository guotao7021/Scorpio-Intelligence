import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {normalizePortfolioInput,analyzeAccountPortfolio,previewAccountScenario} from '../src/account-portfolio-model.mjs';
import {loadAccountInput,saveAccountInput,assertLegacyPortfolioWritable,saveLegacyPortfolioInput,registerAccountPortfolioRoutes} from '../src/account-portfolio.mjs';

const NOW=new Date('2026-11-03T02:00:00Z');
const raw=()=>({holdings_as_of:'2026-11-03',cash_as_of:'2026-11-03',currency:'CNY',cash_total:'20000',cash_available:'20000',
  targets_confirmed:true,policy:{single_max_pct:25,min_cash_pct:20,invested_min_pct:60,invested_max_pct:80},positions:[
    {asset_type:'stock',code:'000001',quantity:'3500',cost_price:'9'},
    {asset_type:'stock',code:'600000',quantity:'4500',cost_price:null}]});
const fact=(code,extra={})=>({instrument_id:'CN:stock:'+code,currency:'CNY',price_basis:'unadjusted',price:'10',
  price_as_of:'2026-11-02',available_at:'2026-11-02T21:00:00Z',source_ref:'sha256:source-'+code,quality:'complete',industry:'银行',board:'主板',...extra});
async function analysis(input=raw(),facts=[fact('000001'),fact('600000')]){
  return analyzeAccountPortfolio({portfolio_id:'test',revision:1,input:normalizePortfolioInput(input,NOW),input_hash:'input-hash'},facts,NOW);
}
function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);');
  for(const file of ['0015_mobile_client_state.sql','0032_mobile_account_portfolio.sql'])sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const DB={prepare(text){const stmt={values:[],bind(...args){this.values=args;return this;},
    first:async()=>sql.prepare(text).get(...stmt.values)||null,all:async()=>({results:sql.prepare(text).all(...stmt.values)}),
    run:async()=>({meta:{changes:Number(sql.prepare(text).run(...stmt.values).changes)}})};return stmt;},
    async batch(items){sql.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result;}
      catch(e){sql.exec('ROLLBACK');throw e;}}};
  return {sql,env:{DB}};
}
async function save(env,user=1,input=raw(),key='request_abcdefgh123456',expected=0){
  const state=await loadAccountInput(env,user,NOW);
  return saveAccountInput(env,user,{portfolio_id:state.portfolio_id,legacy_hash:state.legacy_hash,
    expected_revision:expected,idempotency_key:key,input},NOW);
}
test('account denominator includes cash; missing cost never becomes zero PnL',async()=>{
  const a=await analysis();
  assert.equal(a.valuation.total_assets,100000);assert.equal(a.valuation.invested_pct,80);assert.equal(a.valuation.cash_pct,20);
  assert.equal(a.positions[0].weight_pct,35);assert.equal(a.valuation.unrealized_pnl,null);assert.equal(a.valuation.unrealized_pnl_pct,null);
  assert.equal(a.guidance.find(g=>g.id.startsWith('single:')).reference_delta_amount,-10000);
  assert.equal(a.risk.score,null);assert.equal(a.orders_authorized,false);
});
test('unknown cash, explicit zero and pure cash are distinct',async()=>{
  const input=raw();input.cash_total=null;input.cash_available=null;
  let a=await analysis(input);assert.equal(a.valuation.total_assets,null);assert.equal(a.valuation.invested_pct,null);assert.equal(a.positions[0].weight_pct,null);
  input.cash_total='0';input.cash_available='0';a=await analysis(input);assert.equal(a.valuation.invested_pct,100);
  input.positions=[];input.cash_total='1000';a=await analysis(input,[]);assert.equal(a.status,'available');assert.equal(a.valuation.total_assets,1000);assert.equal(a.valuation.invested_pct,0);
});
test('missing/stale/future/wrong identity quotes never fall back to cost or fake safe weights',async()=>{
  for(const changed of [{price:null},{quality:'partial'},{price_as_of:'2026-10-01'},
    {available_at:'2026-11-04T00:00:00Z'},{currency:'USD'},{price_basis:'adjusted'},{instrument_id:'CN:stock:000002'}]){
    const a=await analysis(raw(),[fact('000001',changed),fact('600000')]);
    assert.equal(a.valuation.market_value,null);assert.equal(a.valuation.total_assets,null);assert.equal(a.valuation.priced_count,1);assert.equal(a.status,'partial');
  }
});
test('known published session covers long market holidays, without inventing a new price date',async()=>{
  const a=await analysis(raw(),[fact('000001',{price_as_of:'2026-09-30',current_session_date:'2026-09-30'}),fact('600000')]);
  assert.equal(a.valuation.priced_count,2);assert.equal(a.positions[0].price_as_of,'2026-09-30');
});
test('integer-cent math and known zero cost retain real zero, percent remains undefined',async()=>{
  const input=raw();input.positions=[{asset_type:'fund',code:'000001',quantity:'100.125',cost_price:'0'}];
  const a=await analysis(input,[fact('000001',{instrument_id:'CN:fund:000001',price:'1.2345'})]);
  assert.equal(a.valuation.market_value,123.6);assert.equal(a.valuation.total_cost,0);assert.equal(a.valuation.unrealized_pnl,123.6);assert.equal(a.valuation.unrealized_pnl_pct,null);
});
test('invalid amounts, duplicate canonical identity and oversized inputs are rejected without clipping',()=>{
  for(const alter of [p=>p.positions.push({...p.positions[0],code:'SZ000001'}),p=>p.positions[0].quantity='NaN',
    p=>p.cash_total='-1',p=>p.cash_available='20001',p=>p.holdings_as_of='2026-11-04',p=>p.currency='USD',
    p=>p.positions[0].quantity='1.5',p=>p.cash_total='0.001',p=>p.policy.min_cash_pct=90,p=>p.targets_confirmed=false,
    p=>p.positions=Array(201).fill(p.positions[0])]){
    const p=raw();alter(p);assert.throws(()=>normalizePortfolioInput(p,NOW));
  }
});
test('scenario is self-financing, carries conditions and never changes holdings or claims execution',async()=>{
  const a=await analysis(),before=JSON.stringify(a);
  const s=await previewAccountScenario(a,{analysis_key:a.analysis_key,adjustments:[{instrument_id:'CN:stock:000001',delta_amount:'-10000'}]});
  assert.equal(s.before.total_assets,s.after.total_assets);assert.equal(s.after.invested_pct,70);assert.equal(s.after.cash_pct,30);
  assert.equal(s.positions.find(p=>p.instrument_id.endsWith('000001')).weight_pct,25);
  assert.equal(s.execution_authorized,false);assert.equal(s.state,'conditional');assert.equal(JSON.stringify(a),before);
  assert.equal(s.after.unrealized_pnl,undefined);
});
test('scenarios reject stale facts, outside assets, oversells and cash overrun',async()=>{
  const a=await analysis();
  for(const req of [{analysis_key:'old',adjustments:[]},
    {analysis_key:a.analysis_key,adjustments:[{instrument_id:'CN:stock:999999',delta_amount:'-1'}]},
    {analysis_key:a.analysis_key,adjustments:[{instrument_id:'CN:stock:000001',delta_amount:'-35001'}]},
    {analysis_key:a.analysis_key,adjustments:[{instrument_id:'CN:stock:000001',delta_amount:'20001'}]}]){
    await assert.rejects(previewAccountScenario(a,req));
  }
  const input=raw();input.cash_available=null;const b=await analysis(input);
  await assert.rejects(previewAccountScenario(b,{analysis_key:b.analysis_key,adjustments:[{instrument_id:'CN:stock:000001',delta_amount:'1'}]}),/available_cash_required/);
});
test('saving legacy creates only user-confirmed input, preserving legacy and unknown cash until then',async()=>{
  const {env,sql}=fixture();try{
    const old=JSON.stringify([{asset_type:'stock',code:'000001',quantity:100,cost_price:0,current_price:999}]);
    sql.prepare('INSERT INTO mobile_portfolio_snapshots VALUES(?,?,?)').run(1,old,'2026-10-01');
    const legacy=await loadAccountInput(env,1,NOW);assert.equal(legacy.input.cash_total,null);assert.equal(legacy.input.positions[0].cost_price,null);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM mobile_account_portfolios').get().n,0);
    const saved=await save(env);assert.equal(saved.revision,1);assert.equal(sql.prepare('SELECT positions_json FROM mobile_portfolio_snapshots').get().positions_json,old);
    await assert.rejects(assertLegacyPortfolioWritable(env,1),/upgrade_required/);await assertLegacyPortfolioWritable(env,2);
  }finally{sql.close();}
});
test('CAS, idempotence, changed legacy and cross-user scope preserve all prior inputs',async()=>{
  const {env,sql}=fixture();try{
    const first=await save(env),same=await save(env);assert.equal(same.revision,1);assert.equal(same.idempotent,true);
    await assert.rejects(save(env,1,raw(),'another_request_12345',0),/revision_conflict/);
    const changed=raw();changed.cash_total='30000';await assert.rejects(save(env,1,changed),/idempotency_conflict/);
    const other=await loadAccountInput(env,2,NOW);
    await assert.rejects(saveAccountInput(env,2,{portfolio_id:first.portfolio_id,expected_revision:0,idempotency_key:'cross_request_12345',input:raw()},NOW),/not_found/);
    const oldHash=other.legacy_hash;sql.prepare('INSERT INTO mobile_portfolio_snapshots VALUES(?,?,?)').run(2,'[{}]','old');
    await assert.rejects(saveAccountInput(env,2,{expected_revision:0,legacy_hash:oldHash,idempotency_key:'changed_request_12345',input:raw()},NOW));
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM mobile_account_portfolio_revisions').get().n,1);
  }finally{sql.close();}
});
test('v2 routes derive owner from auth and plans store reference only',async()=>{
  const {env,sql}=fixture(),routes=new Map();try{
    await save(env);
    registerAccountPortfolioRoutes({route:(m,p,h)=>routes.set(m+' '+p,h),readJson:r=>r.json(),json:v=>v,
      authorize:async ctx=>({user:{id:ctx.owner},license:{}}),resolveFacts:async()=>[fact('000001'),fact('600000')],clock:()=>NOW});
    const call=(action,body,owner=1,method='POST')=>routes.get(method+' /v2/mobile/portfolio/'+action)({env,owner,
      request:new Request('https://test.invalid',{method,body:JSON.stringify(body)})});
    const q=await call('query',{}),p=q.portfolio;
    // Bind actual real-time quote freshness for route tests.
    assert.equal(p.portfolio_id,(await loadAccountInput(env,1)).portfolio_id);
    await assert.rejects(call('query',{portfolio_id:p.portfolio_id,user_id:1},2),/not_found/);
    const b={portfolio_id:p.portfolio_id,analysis_key:p.analysis_key,adjustments:[{instrument_id:'CN:stock:000001',delta_amount:'-1'}],plan_id:'plan_reference_123456'};
    const result=await call('plans',b);assert.equal(result.orders_authorized,false);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM mobile_account_portfolio_plans').get().n,1);
    assert.equal((await call('history',{})).plans[0].scenario.after.cash_total,20001);
    assert.equal((await call('history',{})).plans[0].state,'reference');
    assert.equal((await call('history',{},2)).plans.length,0);
    assert.equal(sql.prepare('SELECT revision FROM mobile_account_portfolios').get().revision,1);
  }finally{sql.close();}
});

test('a legacy writer cannot overwrite input after the first v2 save, even if its precheck ran first',async()=>{
  const {env,sql}=fixture();try{
    await assertLegacyPortfolioWritable(env,1);
    await saveLegacyPortfolioInput(env,1,[],NOW.toISOString());
    await save(env);
    await assert.rejects(saveLegacyPortfolioInput(env,1,[{code:'600001'}],NOW.toISOString()),/upgrade_required/);
    assert.equal(sql.prepare('SELECT positions_json FROM mobile_portfolio_snapshots WHERE user_id=1').get().positions_json,'[]');
    assert.equal((await loadAccountInput(env,1,NOW)).revision,1);
    await saveLegacyPortfolioInput(env,2,[],NOW.toISOString());
  }finally{sql.close();}
});

test('plans expire when quotes change and become superseded when the snapshot changes',async()=>{
  const {env,sql}=fixture(),routes=new Map();let price='10';try{
    await save(env);
    registerAccountPortfolioRoutes({route:(m,p,h)=>routes.set(m+' '+p,h),readJson:r=>r.json(),json:v=>v,
      authorize:async()=>({user:{id:1},license:{}}),resolveFacts:async()=>[fact('000001',{price}),fact('600000')],clock:()=>NOW});
    const call=(a,b={})=>routes.get('POST /v2/mobile/portfolio/'+a)({env,request:new Request('https://test.invalid',{method:'POST',body:JSON.stringify(b)})});
    const a=(await call('query')).portfolio;
    const b={analysis_key:a.analysis_key,adjustments:[{instrument_id:'CN:stock:000001',delta_amount:'-1'}],plan_id:'test_plan_abcdefgh'};
    await call('plans',b);await call('plans',b);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM mobile_account_portfolio_plans').get().n,1);
    price='11';await assert.rejects(call('plans',b),/analysis_changed/);
    assert.equal((await call('history')).plans[0].state,'expired');
    await save(env,1,raw(),'second_save_abcdef',1);
    assert.equal((await call('history')).plans[0].state,'superseded');
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM mobile_account_portfolio_revisions').get().n,2);
  }finally{sql.close();}
});
