import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {minuteUploadPlan} from '../src/minute-upload-plan.mjs';
import worker from '../src/worker.js';
import {canonical,digest} from '../src/minute-delivery.mjs';
import {publishBetaDirect,revokeBetaDirect} from '../src/minute-beta-direct.mjs';
import {sessionFixture} from './market-session-fixture.mjs';

const day='2026-09-30',now=new Date('2026-10-06T04:00:00Z');
function fixture() {
  const db=new DatabaseSync(':memory:');
  for (const f of ['0008_production_uploads.sql','0026_minute_result_delivery.sql','0028_minute_beta_direct_delivery.sql'])
    db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
  db.exec(`INSERT INTO production_upload_batches(batch_id,module,status,created_at,updated_at)
    VALUES('ok','target_research','committed','x','x'),('pending','target_research','created','x','x')`);
  const insert=db.prepare(`INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)`);
  for (const [table,code,batch,date,edition,asset] of [
      ['score_history','000001','ok',day,'standard_pro','stock'],
      ['score_history','600036','ok',day,'standard_pro','stock'],
      ['score_history','600001','pending','2026-10-05','standard_pro','stock'],
      ['score_history','600002','ok','2026-10-05','internal','stock'],
      ['score_history','000003','ok','2026-10-05','standard_pro','fund'],
      ['market_score_daily','market','ok',day,'standard_pro','market']])
    insert.run(table,code,'h',JSON.stringify({code,asset_type:asset}),date,edition,'target_research',batch,'x');
  const env={MINUTE_BETA_DIRECT_ENABLED:'1',DB:{prepare(sql){return {bind(...args){return {
    first:async()=>db.prepare(sql).get(...args)||null,
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}}),
  };},first:async()=>db.prepare(sql).get()||null,all:async()=>({results:db.prepare(sql).all()})};}}};
  return {db,env};
}
async function publication() {
  const p={schema_version:'stock-minute-explanation.v1',code:'000001',business_date:day,scope:'market',
    interval_minutes:5,price_basis:'unadjusted',available_at:'2026-10-05T12:00:00',observed_through:null,historical:true,
    status:'available',reason_code:'',reason_text:'',explanation_mode:'local_knowledge',knowledge_binding:{version:'k.v1',content_hash:'a'.repeat(64)},
    conclusion:{headline:'历史观察',label:'解读',status:'available',boundary:'不是交易指令',evidence:[],counter_evidence:[],limitations:[],follow_up_questions:[]},
    indicator_cards:[],charts:{price_vwap:[],price_volume_states:[],return_amplitude:[],breakout_events:[]},tables:[],
    coverage:{classification_label:'',membership_missing:false},display_only:true,formal_use_allowed:false,order_authorized:false,
    model_called:false,observation_binding_hash:'b'.repeat(64),market_session:sessionFixture(day)};
  const payload_json=canonical(p);
  return {version:'minute-beta-direct.v1',channel:'beta',publication_id:'auto-one',code:p.code,business_date:day,
    generated_at:'2026-10-05T13:00:00',packs:[{payload_json,content_hash:await digest(payload_json)}],
    expected_previous_publication_id:'',edition_scopes:['standard_pro'],expires_at:'2026-10-07T12:00:00',
    min_client_version:'0.3.0',display_only:true,normal_daily_acceptance_passed:false};
}
test('exact latest committed public STOCK sample only, closed date and aligned market',async()=>{
  const {db,env}=fixture();try {
    const result=await minuteUploadPlan(env,{},'owner',now);
    assert.equal(result.business_date,day);assert.deepEqual(result.sample_codes,['000001','600036']);
    assert.deepEqual(result.heads,[]);
    for (const body of [{business_date:'2026-09-29'},{business_date:'2026-10-07'},{verify_codes:['600000']},
      {verify_codes:['000001','000001']},{verify_market:1},{sql:'SELECT * FROM users'}])
      await assert.rejects(minuteUploadPlan(env,body,'owner',now));
    db.exec(`UPDATE production_table_rows SET data_date='2026-09-29' WHERE table_name='market_score_daily'`);
    await assert.rejects(minuteUploadPlan(env,{},'owner',now),/market_date_not_aligned/);
  }finally{db.close();}
});
test('readback uses shared Beta serving, matching hashes and business market head; no private payload',async()=>{
  const {db,env}=fixture();try {
    const body=await publication();await publishBetaDirect(env,body,'owner',now);
    const result=await minuteUploadPlan(env,{business_date:day,verify_codes:['000001'],verify_market:true},'owner',now);
    assert.equal(result.verified[0].status,'published');assert.equal(result.verified[0].market_points,48);
    assert.equal(result.heads[0].packs_signature,body.packs[0].content_hash);
    assert.equal(result.market_readback.status,'available');assert.equal(result.market_readback.points,48);
    assert.doesNotMatch(JSON.stringify(result),/payload_json|row_json|published_by|knowledge_binding/);
    await revokeBetaDirect(env,{publication_id:body.publication_id,reason:'test'},'owner',now);
    const revoked=await minuteUploadPlan(env,{verify_codes:['000001'],verify_market:true},'owner',now);
    assert.equal(revoked.verified[0].status,'withdrawn');assert.equal(revoked.market_readback.status,'unavailable');
  }finally{db.close();}
});
test('unified upload planning remains admin-only',async()=>{
  const response=await worker.fetch(new Request('https://example.invalid/v1/scorpio_v1_admin/minute-results/beta-upload-plan',
    {method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{});
  assert.equal(response.status,403);
});

test('committed public delisted pool entries are excluded, missing/private/uncommitted states are not',async()=>{
  const {db,env}=fixture();try {
    const insert=db.prepare('INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)');
    insert.run('stock_analysis_pool','000001','h',JSON.stringify({code:'000001',status:'delisted'}),day,'standard_pro','target_research','pending','x');
    assert.deepEqual((await minuteUploadPlan(env,{},'owner',now)).sample_codes,['000001','600036']);
    db.exec("UPDATE production_table_rows SET batch_id='ok',edition_scope='internal' WHERE table_name='stock_analysis_pool'");
    assert.deepEqual((await minuteUploadPlan(env,{},'owner',now)).sample_codes,['000001','600036']);
    db.exec("UPDATE production_table_rows SET edition_scope='standard_pro' WHERE table_name='stock_analysis_pool'");
    const plan=await minuteUploadPlan(env,{},'owner',now);
    assert.deepEqual(plan.sample_codes,['600036']);
    assert.deepEqual(plan.excluded_samples,[{code:'000001',reason:'current_pool_delisted'}]);
  }finally{db.close();}
});
