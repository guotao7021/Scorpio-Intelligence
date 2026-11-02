import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedMarketFlow} from '../src/market-flow-display.mjs';
import {marketRiskPortrait} from '../src/mobile-risk-portrait.mjs';
import {__mobilePresentationTest as presentation} from '../src/worker.js';
const day='2026-10-13';
const proxy={id:9840,trade_date:day,data_source:'industry_fund_flow_proxy',main_net:7990000000,super_net:0,big_net:0};
const batch={id:9858,trade_date:day,data_source:'tushare_moneyflow_mkt_dc',main_net:-9139605504,super_net:-2831761408,big_net:-6307844096};
test('published market capital and risk choose actual batch rather than industry proxy regardless of row order',()=>{
  for(const flowRows of [[proxy,batch],[batch,proxy]]) {
    const selected=publishedMarketFlow(flowRows);assert.equal(selected,batch);
    const p=presentation.mobileMarketCenterPayload({flowRows});
    assert.match(p.capital.main_net,/-91\.40/);assert.match(p.capital.super_net,/-28\.32/);assert.match(p.capital.big_net,/-63\.08/);
    assert.equal(p.data_dates.capital,day);
    const risk=marketRiskPortrait({observation:{business_date:day},flowRows,capitalValue:v=>String(v??'--')});
    assert.equal(risk.groups[0].items.find(i=>i.title==='主力资金净额').value,String(batch.main_net));
  }
});
test('proxy-only broad market amounts are missing, never fabricated zeros or industry totals',()=>{
  assert.equal(publishedMarketFlow([proxy]),null);
  const p=presentation.mobileMarketCenterPayload({flowRows:[proxy]});
  assert.equal(p.capital.main_net,'--');assert.equal(p.capital.super_net,'--');assert.equal(p.capital.big_net,'--');
  assert.equal(p.data_dates.capital,'未提供');
});
test('precise day and CNY fence reject future, different day and wrong units',()=>{
  assert.equal(publishedMarketFlow([batch],{day:'2026-10-12'}),null);
  assert.equal(publishedMarketFlow([{...batch,amount_unit:'万元'}]),null);
  assert.equal(publishedMarketFlow([{...batch,_amount_unit:'USD'}]),null);
});
test('batch source outranks realtime and newest row identity breaks same-source ties, not value',()=>{
  const rt={...batch,id:99999,data_source:'eastmoney',main_net:999};
  const later={...batch,id:9859,main_net:0};
  assert.equal(publishedMarketFlow([rt,batch,later]),later);
  assert.equal(publishedMarketFlow([rt]),rt);
});
test('legacy observation without recognized source preserves true zero but cannot override declared sources',()=>{
  const old={trade_date:day,main_net:0};
  assert.equal(publishedMarketFlow([old]),old);
  assert.equal(publishedMarketFlow([old,proxy]),null);
  assert.equal(publishedMarketFlow([old,batch]),batch);
});
