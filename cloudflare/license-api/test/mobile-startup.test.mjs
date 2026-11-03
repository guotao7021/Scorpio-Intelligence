import assert from 'node:assert/strict';
import test from 'node:test';
import worker, {__mobilePresentationTest as presentation} from '../src/worker.js';
import {loadBootstrapWorkloads} from '../src/mobile-startup.mjs';

function loaders(calls) {
  return Object.fromEntries(['positions','market','publishedMarket','deferredPortfolio','portfolio','package','watchlist','samples','compliance','briefs']
    .map(name=>[name,async()=>{calls.push(name);return name==='positions'?['owned-position']:{name};}]));
}
test('home-first cannot enter compute or private legacy position enrichment',async()=>{
  const calls=[],read=loaders(calls);
  for(const name of ['positions','market','portfolio']) read[name]=()=>assert.fail('blocking workload '+name);
  const result=await loadBootstrapWorkloads(read,true);
  assert.deepEqual(result.savedPositions,[]);
  assert.equal(result.market.name,'publishedMarket');
  assert.equal(result.portfolio.name,'deferredPortfolio');
  assert.ok(calls.includes('compliance')&&calls.includes('watchlist')&&calls.includes('briefs'));
});
test('legacy callers keep the position/portfolio dependency and full market path',async()=>{
  const calls=[],read=loaders(calls);
  read.portfolio=async positions=>{assert.deepEqual(positions,['owned-position']);return {legacy:true};};
  const result=await loadBootstrapWorkloads(read,false);
  assert.equal(result.market.name,'market');assert.equal(result.portfolio.legacy,true);
  assert.ok(!calls.includes('publishedMarket')&&!calls.includes('deferredPortfolio'));
});
test('a compliance read failure cannot become successful home readiness',async()=>{
  const read=loaders([]);read.compliance=async()=>{throw new Error('notice_read_failed');};
  await assert.rejects(loadBootstrapWorkloads(read,true),/notice_read_failed/);
});
test('fast startup flag never bypasses real endpoint authentication',async()=>{
  let reads=0;
  const response=await worker.fetch(new Request('https://example.invalid/v1/mobile/bootstrap',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bootstrap_scope:'home',portfolio_api_version:2}),
  }),{DB:{prepare(){reads++;throw new Error('unauthorized read');}}});
  assert.equal(response.status,401);assert.equal(reads,0);
});

test('home scope describes deferred portfolio as pending, never empty or already synced',()=>{
  const result=presentation.mobileBootstrapPayload({
    user:{id:7,email:'fixture@example.com'},license:{license_id:'fixture',edition:'personal_pro',expires_at:'2030-01-01T00:00:00Z'},
    market:{status:'partial',summary:{},sections:{}},portfolio:{status:'empty',summary:{}},positions:[],homeFirst:true,
  });
  assert.equal(result.source.portfolio_status,'deferred');
  assert.equal(result.home.portfolio_risk,'组合读取中');
  assert.equal(result.briefing.headline,'市场研究摘要');
  assert.ok(!result.briefing.summary.includes('同步持仓'));
});
