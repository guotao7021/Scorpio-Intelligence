import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {canonical,digest,readPublication} from '../src/minute-delivery.mjs';
import {prepareBetaPublication,publishBetaDirect,revokeBetaDirect,isBetaClient} from '../src/minute-beta-direct.mjs';
import {readMarketMinuteObservation} from '../src/market-minute-observation.mjs';
import {sessionFixture} from './market-session-fixture.mjs';

const now=new Date('2026-10-06T04:00:00Z');
const request={code:'603190',businessDate:'2026-09-30',editionScopes:['pro'],clientVersion:'0.3.0-beta.21'};
function fixture() {
  const db=new DatabaseSync(':memory:');
  for (const file of ['0026_minute_result_delivery.sql','0028_minute_beta_direct_delivery.sql'])
    db.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  const env={MINUTE_BETA_DIRECT_ENABLED:'1',DB:{prepare(sql){return {bind(...args){return {
    first:async()=>db.prepare(sql).get(...args)||null,
    run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}}),
  };}};}}};
  return {db,env};
}
async function body(n=1,previous='') {
  const pack={schema_version:'stock-minute-explanation.v1',code:request.code,business_date:request.businessDate,scope:'context',
    interval_minutes:5,price_basis:'unadjusted',available_at:'2026-10-05T12:00:00',observed_through:'2026-09-30 09:35:00',historical:true,
    status:'available',reason_code:'',reason_text:'',explanation_mode:'local_knowledge',knowledge_binding:{version:'knowledge.v1',content_hash:'a'.repeat(64)},
    conclusion:{headline:`历史观察${n}`,label:'本地知识解读',status:'available',boundary:'不是交易指令',evidence:['闭柱观察'],counter_evidence:[],limitations:[],follow_up_questions:[]},
    indicator_cards:[],charts:{price_vwap:[{clock:'09:35',bar_time:'2026-09-30 09:35:00',segment:'morning',ordinal:0,close:10,vwap:10,volume_ratio:0}],
      price_volume_states:[],return_amplitude:[],breakout_events:[]},tables:[],coverage:{classification_label:'',membership_missing:false},
    display_only:true,formal_use_allowed:false,order_authorized:false,model_called:false,observation_binding_hash:'b'.repeat(64)};
  const payload_json=canonical(pack);
  return {version:'minute-beta-direct.v1',channel:'beta',publication_id:`beta-${n}`,code:request.code,business_date:request.businessDate,
    generated_at:`2026-10-05T13:00:0${n}`,packs:[{payload_json,content_hash:await digest(payload_json)}],expected_previous_publication_id:previous,
    edition_scopes:['pro'],expires_at:'2026-10-07T12:00:00',min_client_version:'0.3.0',display_only:true,normal_daily_acceptance_passed:false};
}
test('Beta publishes in one step; no candidate or approval records, exact Android envelope',async()=>{
  const {db,env}=fixture();try {
    const b=await body();await publishBetaDirect(env,b,'test-owner',now);
    const r=await readPublication(env,request,now);
    assert.equal(r.status,'published');assert.equal(r.publication_id,b.publication_id);
    assert.deepEqual(r.packs,b.packs);assert.equal(JSON.parse(r.packs[0].payload_json).charts.price_vwap[0].volume_ratio,0);
    for(const kind of ['candidates','approvals','publications'])
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM minute_delivery_${kind}`).get().n,0);
    assert.doesNotMatch(JSON.stringify(r),/published_by|policy_json|edition_scopes|approval|receipt|candidate/);
  }finally{db.close();}
});
test('market projection reuses real verified publication and clears withdrawal and expiry',async()=>{
  const {db,env}=fixture();try {
    const b=await body(), p=JSON.parse(b.packs[0].payload_json);
    p.scope='market'; p.charts={price_vwap:[],price_volume_states:[],return_amplitude:[],breakout_events:[]}; p.observed_through=null;
    p.coverage={classification_label:'',membership_missing:false,observed_count:43,member_count:50,synchrony:0};
    p.indicator_cards=[{metric_id:'sample_synchrony',label:'样本同步度',value:'0.000',status:'available',
      meaning:'分钟收益相关程度',reading:'样本表现分化。',boundary:'不是指数'}];
    p.market_session=sessionFixture(request.businessDate);
    const payload_json=canonical(p); b.packs=[{payload_json,content_hash:await digest(payload_json)}];
    await publishBetaDirect(env,b,'owner',now);
    const result=await readMarketMinuteObservation(env,request,now);
    assert.equal(result.status,'available'); assert.equal(result.session.sample_count,5);
    assert.equal(result.session.points[0].median_return_pct,0);
    assert.equal(result.synchrony,undefined); assert.equal(result.observed_count,undefined);
    assert.equal(result.publication_id,b.publication_id); assert.equal(result.code,undefined); assert.equal(result.charts,undefined);
    const expired=await readMarketMinuteObservation(env,request,new Date('2026-10-07T04:00:00Z'));
    assert.equal(expired.status,'unavailable'); assert.equal(expired.session,undefined);
    await revokeBetaDirect(env,{publication_id:b.publication_id,reason:'test'},'owner',now);
    assert.equal((await readMarketMinuteObservation(env,request,now)).status,'unavailable');
  }finally{db.close();}
});
test('Beta retries are idempotent, conflicting reuse rejected',async()=>{
  const {db,env}=fixture();try{
    const b=await body();await publishBetaDirect(env,b,'owner',now);
    assert.equal((await publishBetaDirect(env,b,'owner',now)).status,'already_published');
    await assert.rejects(publishBetaDirect(env,{...b,edition_scopes:['standard']},'owner',now),/id_conflict/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM minute_beta_publications').get().n,1);
  }finally{db.close();}
});
test('Beta serves only latest same day and exact stock, date, channel',async()=>{
  const {db,env}=fixture();try{
    await publishBetaDirect(env,await body(),'owner',now);
    await publishBetaDirect(env,await body(2,'beta-1'),'owner',now);
    assert.equal((await readPublication(env,request,now)).publication_id,'beta-2');
    for(const diff of [{code:'000001'},{businessDate:'2026-09-29'},{clientVersion:'0.3.0'},{clientVersion:'0.3.0-beta.21-extra'}])
      assert.equal((await readPublication(env,{...request,...diff},now)).status,'missing');
    assert.equal((await readPublication({...env,MINUTE_BETA_DIRECT_ENABLED:'0'},request,now)).status,'missing');
  }finally{db.close();}
});
test('concurrent Beta publishers use atomic head compare-and-set',async()=>{
  const {db,env}=fixture();try{
    const attempts=await Promise.allSettled([1,2].map(async n=>publishBetaDirect(env,await body(n),'owner',now)));
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
  }finally{db.close();}
});
test('older generated time cannot replace latest even with space vs T timestamp',async()=>{
  const {db,env}=fixture();try{
    await publishBetaDirect(env,await body(2),'owner',now);
    await assert.rejects(publishBetaDirect(env,{...await body(1,'beta-2'),generated_at:'2026-10-05 13:00:01'},'owner',now),/head_changed/);
    assert.equal((await readPublication(env,request,now)).publication_id,'beta-2');
  }finally{db.close();}
});
test('withdrawn Beta head never falls back and publication retry cannot resurrect it',async()=>{
  const {db,env}=fixture();try{
    await publishBetaDirect(env,await body(),'owner',now);const b=await body(2,'beta-1');
    await publishBetaDirect(env,b,'owner',now);await revokeBetaDirect(env,{publication_id:'beta-2',reason:'来源更正'},'owner',now);
    await publishBetaDirect(env,b,'owner',now);
    const r=await readPublication(env,request,now);assert.equal(r.status,'withdrawn');assert.deepEqual(r.packs,[]);
  }finally{db.close();}
});
test('exact Beta expiry clears head without earlier fallback',async()=>{
  const {db,env}=fixture();try{
    await publishBetaDirect(env,{...await body(),expires_at:'2026-10-08T12:00:00'},'owner',now);
    await publishBetaDirect(env,await body(2,'beta-1'),'owner',now);
    assert.equal((await readPublication(env,request,new Date('2026-10-07T03:59:59Z'))).status,'published');
    assert.equal((await readPublication(env,request,new Date('2026-10-07T04:00:00Z'))).status,'expired');
  }finally{db.close();}
});
for(const column of ['envelope_json','policy_json','generated_at','published_at'])
  test(`corrupt Beta ${column} never uncovers older result`,async()=>{
    const {db,env}=fixture();try{
      await publishBetaDirect(env,await body(),'owner',now);await publishBetaDirect(env,await body(2,'beta-1'),'owner',now);
      db.exec('DROP TRIGGER minute_beta_no_update');
      db.prepare(`UPDATE minute_beta_publications SET ${column}=? WHERE publication_id='beta-2'`).run('broken');
      const r=await readPublication(env,request,now);assert.equal(r.status,'unavailable');assert.deepEqual(r.packs,[]);
    }finally{db.close();}
  });
test('policy editions and capability enforced, no fallback',async()=>{
  const {db,env}=fixture();try{
    await publishBetaDirect(env,await body(),'owner',now);
    await publishBetaDirect(env,{...await body(2,'beta-1'),edition_scopes:['internal'],min_client_version:'0.4.0'},'owner',now);
    assert.equal((await readPublication(env,request,now)).status,'not_entitled');
    assert.equal((await readPublication(env,{...request,editionScopes:['internal']},now)).status,'client_update_required');
    assert.equal((await readPublication(env,{...request,editionScopes:['internal'],clientVersion:'0.4.0-beta.1'},now)).status,'published');
  }finally{db.close();}
});
test('Beta remains immutable; withdrawal during verification is rechecked',async()=>{
  const {db,env}=fixture();try{
    await publishBetaDirect(env,await body(),'owner',now);let injected=false;
    const racing={...env,DB:{prepare(sql){const s=env.DB.prepare(sql);return {bind(...args){const b=s.bind(...args);return {...b,first:async()=>{
      const r=await b.first();if(!injected&&sql.includes('SELECT p.*,r.publication_id')){
        injected=true;await revokeBetaDirect(env,{publication_id:'beta-1',reason:'concurrent'},'owner',now);
      }return r;
    }};}};}}};
    assert.equal((await readPublication(racing,request,now)).status,'withdrawn');
    for(const table of ['minute_beta_publications','minute_beta_revocations'])
      for(const operation of [`DELETE FROM ${table}`,`UPDATE ${table} SET publication_id='other'`])
        assert.throws(()=>db.exec(operation),/immutable/);
  }finally{db.close();}
});
test('bad source pack, authority flags, private fields and expiry rejected before writing',async()=>{
  const {db,env}=fixture();try{
    const b=await body();
    for(const diff of [{channel:'stable'},{normal_daily_acceptance_passed:true},{display_only:false},{source_path:'private'},
      {code:'000001'},{edition_scopes:['unknown']},{edition_scopes:['pro','pro']},{generated_at:'2026-10-07T12:00:00'},
      {expires_at:'2026-10-06T12:00:00'},{expires_at:'2026-10-14T12:00:00'},{min_client_version:'bad'},
      {packs:[{...b.packs[0],content_hash:'0'.repeat(64)}]}])
      await assert.rejects(publishBetaDirect(env,{...b,...diff},'owner',now));
    const p={...JSON.parse(b.packs[0].payload_json),order_authorized:true},payload_json=canonical(p);
    await assert.rejects(publishBetaDirect(env,{...b,packs:[{payload_json,content_hash:await digest(payload_json)}]},'owner',now));
    await assert.rejects(prepareBetaPublication(b,'invalid actor',now));
    await assert.rejects(publishBetaDirect({...env,MINUTE_BETA_DIRECT_ENABLED:'0'},b,'owner',now),/disabled/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM minute_beta_publications').get().n,0);
  }finally{db.close();}
});
test('new Beta HTTP endpoints still reject unauthenticated administrator calls',async()=>{
  for(const action of ['beta-publish','beta-revoke']) {
    const r=await worker.fetch(new Request(`https://unit.test/v1/scorpio_v1_admin/minute-results/${action}`,{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{},{});
    assert.equal(r.status,403);assert.equal((await r.json()).error,'admin_token_required');
  }
});
test('Beta version detection is explicit, not any development version',()=>{
  for(const v of ['0.3.0-beta.21','12.3.2-beta.1']) assert.equal(isBetaClient(v),true);
  for(const v of [undefined,'0.3.0','0.3.0-dev.1','0.3.0-beta','0.3.0-beta.1-extra']) assert.equal(isBetaClient(v),false);
});
