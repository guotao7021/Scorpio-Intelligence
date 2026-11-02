import assert from 'node:assert/strict';
import test from 'node:test';
import {validateMarketSession} from '../src/market-session-contract.mjs';
import {sessionFixture} from './market-session-fixture.mjs';
import {canonical,digest,validatePacks} from '../src/minute-delivery.mjs';
const day='2026-10-08';
test('real zero, unavailable VWAP and explicit first regular baseline stay distinct',()=>{
  const s=sessionFixture();assert.equal(validateMarketSession(s,day),s);
  assert.equal(s.points[0].flat_count,5);assert.equal(s.points[47].vwap_valid_count,0);
});
test('wrong unit/cohort/clock/count, private fields and unsupported inference fail closed',()=>{
  for(const change of [s=>s.baseline='previous_close',s=>s.scope='market_index',s=>s.amount_unit='万元',
    s=>s.source_run_id='private',s=>s.sample_count=1,s=>s.points[24].clock='12:00',s=>s.points[0].median_return_pct=1,
    s=>s.points[5].advancing_count=6,s=>s.points[5].amount_yuan=NaN,s=>s.periods[0].amount_yuan=1,
    s=>s.chain[0].private_prompt='private']) {
    const s=sessionFixture();change(s);assert.throws(()=>validateMarketSession(s,day));
  }
});
test('public extension remains hash-bound and market-only in the actual delivery validator',async()=>{
  const p={schema_version:'stock-minute-explanation.v1',code:'600519',business_date:day,scope:'market',interval_minutes:5,
    price_basis:'unadjusted',available_at:day+'T20:00:00',observed_through:null,historical:true,status:'partial',reason_code:'',reason_text:'',
    explanation_mode:'local_knowledge',knowledge_binding:null,conclusion:{headline:'观察',label:'解读',status:'unavailable',boundary:'复盘',evidence:[],counter_evidence:[],limitations:[],follow_up_questions:[]},
    indicator_cards:[],charts:{price_vwap:[],price_volume_states:[],return_amplitude:[],breakout_events:[]},tables:[],coverage:{classification_label:'',membership_missing:false},
    display_only:true,formal_use_allowed:false,order_authorized:false,model_called:false,observation_binding_hash:'a'.repeat(64),market_session:sessionFixture()};
  const entries=async()=>{const payload_json=canonical(p);return [{payload_json,content_hash:await digest(payload_json)}];};
  assert.deepEqual(await validatePacks(await entries(),'600519',day,day+'T21:00:00'),['market']);
  p.scope='stock';await assert.rejects(validatePacks(await entries(),'600519',day,day+'T21:00:00'),/scope_invalid/);
});
