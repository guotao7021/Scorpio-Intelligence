import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {readMarketMinuteObservation} from '../src/market-minute-observation.mjs';
import {sessionFixture} from './market-session-fixture.mjs';

const day = '2026-10-08', now = new Date('2026-10-11T02:00:00Z');
const request = {businessDate:day,editionScopes:['standard_pro'],clientVersion:'0.3.0-beta.22'};
function database() {
  const db = new DatabaseSync(':memory:');
  for (const table of ['minute_beta_publications','minute_delivery_publications'])
    db.exec(`CREATE TABLE ${table}(seq INTEGER PRIMARY KEY,code TEXT,business_date TEXT,publication_id TEXT,published_at TEXT)`);
  db.exec(readFileSync(new URL('../migrations/0030_market_minute_head_index.sql',import.meta.url),'utf8'));
  const env = {MINUTE_BETA_DIRECT_ENABLED:'1',DB:{prepare(sql){return {bind(...params){return {
    async first(){return db.prepare(sql).get(...params)||null;},
  };}};}}};
  const insert = (id, code='600519', table='minute_beta_publications', date=day) =>
    db.prepare(`INSERT INTO ${table}(code,business_date,publication_id,published_at) VALUES(?,?,?,?)`).run(code,date,id,`${date}T20:00:00`);
  return {db,env,insert};
}
function envelope(id='new') {
  return {status:'published',publication_id:id,expires_at:'2026-10-14T20:00:00',packs:[{payload_json:JSON.stringify({
    scope:'market',status:'available',available_at:`${day}T20:00:00`,
    indicator_cards:[{metric_id:'sample_synchrony',status:'available',reading:'同向程度较低，样本表现分化。'}],
    coverage:{observed_count:43,member_count:50,synchrony:0},
    market_session:sessionFixture(day),
    charts:{price_vwap:[{close:999}]},code:'600519', private_binding:'never emit',
  })}]};
}
test('projects exact-day market samples only; no per-stock chart/metadata or compute', async () => {
  const {db,env,insert} = database();
  try {
    insert('old'); insert('new'); insert('other-date','000858','minute_beta_publications','2026-10-09');
    let calls=0;
    const value = await readMarketMinuteObservation(env,request,now,async (_,r) => {
      calls++; assert.equal(r.code,'600519'); assert.equal(r.businessDate,day); assert.deepEqual(r.editionScopes,request.editionScopes); return envelope();
    });
    assert.equal(calls,1); assert.equal(value.session.points[0].median_return_pct,0);
    assert.equal(value.session.sample_count,5); assert.equal(value.business_date,day);
    for (const key of ['code','charts','packs','private_binding','content_hash','synchrony','observed_count','member_count','coverage']) assert.equal(key in value,false);
  } finally {db.close();}
});
test('exact-day lookup uses the delivery index instead of sorting all publication history', async () => {
  const {db,env,insert} = database();
  try {
    insert('new');
    const prepare=env.DB.prepare;
    env.DB.prepare=(sql)=>{
      const plan=db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(day).map(p=>p.detail).join('\n');
      assert.match(plan,/idx_minute_beta_market_day/); assert.doesNotMatch(plan,/USE TEMP B-TREE FOR ORDER BY/);
      return prepare(sql);
    };
    assert.equal((await readMarketMinuteObservation(env,request,now,async ()=>envelope())).status,'available');
  } finally {db.close();}
});
test('unavailable newest head never exposes another code, older date or formal channel', async () => {
  const {db,env,insert} = database();
  try {
    insert('old'); insert('new','000858'); insert('formal','600519','minute_delivery_publications');
    let calls=0;
    const value = await readMarketMinuteObservation(env,request,now,async (_,r)=> {
      calls++; assert.equal(r.code,'000858'); return {status:'withdrawn',packs:[]};
    });
    assert.equal(value.status,'unavailable'); assert.equal(calls,1);
    for (const state of ['expired','not_entitled','client_update_required','unavailable']) {
      assert.equal((await readMarketMinuteObservation(env,request,now,async ()=>({status:state,packs:[]}))).status,'unavailable');
    }
  } finally {db.close();}
});
test('same-day head change, missing scope and malformed coverage fail closed', async () => {
  const {db,env,insert} = database();
  try {
    insert('new');
    assert.equal((await readMarketMinuteObservation(env,request,now,async ()=>envelope('different'))).status,'unavailable');
    for (const change of [{scope:'stock'}, {market_session:null},
      {market_session:{...sessionFixture(day),baseline:'index_previous_close'}}]) {
      const e=envelope(); e.packs[0].payload_json=JSON.stringify({...JSON.parse(e.packs[0].payload_json),...change});
      assert.notEqual((await readMarketMinuteObservation(env,request,now,async ()=>e)).status,'available');
    }
    assert.equal((await readMarketMinuteObservation(env,{...request,businessDate:'2026-02-30'},now)).status,'unavailable');
    assert.equal((await readMarketMinuteObservation(env,{...request,businessDate:'2026-10-12'},now)).status,'missing');
  } finally {db.close();}
});
test('old quality-only market packs stay backstage, not promoted as commercial indicators',async()=>{
  const {db,env,insert}=database();try{
    insert('new');const e=envelope();const p=JSON.parse(e.packs[0].payload_json);delete p.market_session;e.packs[0].payload_json=JSON.stringify(p);
    const v=await readMarketMinuteObservation(env,request,now,async()=>e);
    assert.equal(v.status,'missing');assert.equal(v.session,undefined);assert.equal(v.synchrony,undefined);
  }finally{db.close();}
});
test('a different-code global head arriving during verification invalidates the projection', async () => {
  const {db,env,insert} = database();
  try {
    insert('new');
    const result = await readMarketMinuteObservation(env,request,now,async ()=> {
      insert('another-head','000858'); return envelope();
    });
    assert.equal(result.status,'unavailable'); assert.equal(result.synchrony,undefined);
  } finally {db.close();}
});
