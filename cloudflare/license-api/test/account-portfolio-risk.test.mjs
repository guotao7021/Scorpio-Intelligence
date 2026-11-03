import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePortfolioInput,analyzeAccountPortfolio} from '../src/account-portfolio-model.mjs';

const now=new Date('2026-11-03T02:00:00Z');
const input=()=>({currency:'CNY',holdings_as_of:'2026-11-03',cash_as_of:'2026-11-03',cash_total:'20000',cash_available:'20000',
  policy:{single_max_pct:25,min_cash_pct:10,invested_max_pct:80},targets_confirmed:true,positions:[
    {asset_type:'stock',code:'600036',name:'招商银行',quantity:'1000',cost_price:'33',sellable_quantity:'1000'},
    {asset_type:'stock',code:'300750',name:'宁德时代',quantity:'100',cost_price:'250',sellable_quantity:'0'},
    {asset_type:'fund',code:'510300',name:'沪深300ETF',quantity:'5000',cost_price:'3.88'}]});
const fact=(type,code,price,industry,board)=>({instrument_id:`CN:${type}:${code}`,currency:'CNY',price_basis:'unadjusted',price,
  price_as_of:'2026-11-02',available_at:'2026-11-02T20:00:00Z',source_ref:code,quality:'complete',industry,board});
const facts=()=>[fact('stock','600036','34','银行','主板'),fact('stock','300750','260','电池','创业板'),fact('fund','510300','4')];
async function analyze(raw=input(),fs=facts()) { const v=normalizePortfolioInput(raw,now);return analyzeAccountPortfolio({portfolio_id:'fixture',revision:1,input:v,input_hash:JSON.stringify(v)},fs,now); }

test('risk separates self-defined limits, exposures, unknowns and no composite score',async()=>{
  const a=await analyze(),r=a.risk;
  assert.equal(a.valuation.total_assets,100000);assert.equal(r.score,null);
  assert.equal(r.largest_position_pct,34);assert.equal(r.focus_instrument_id,'CN:stock:600036');
  assert.equal(r.dimensions.find(d=>d.id==='concentration').state,'target_deviation');
  assert.equal(r.dimensions.find(d=>d.id==='cash').state,'within_target');
  assert.equal(r.dimensions.find(d=>d.id==='board').state,'partial');
  assert.equal(r.dimensions.find(d=>d.id==='industry').not_looked_through_count,1);
  assert.equal(r.dimensions.find(d=>d.id==='research').state,'not_assessed');
  assert.equal(r.dimensions.find(d=>d.id==='liquidity').state,'partial');
  assert.match(r.dimensions.find(d=>d.id==='liquidity').detail,/1项/);
  assert.equal(r.coverage.research_complete,false);
});
test('uniform shock is cash-aware, cent-exact, no likelihood or historical performance claim',async()=>{
  const a=await analyze(),s=a.risk.shocks.find(s=>s.shock_pct===-10);
  assert.equal(s.estimated_change_amount,-8000);assert.equal(s.assets_after,92000);
  assert.equal(s.account_change_pct,-8);assert.equal(s.cash_after,20000);
  assert.match(s.boundary,/不是回撤预测/);assert.equal(s.probability,undefined);
  assert.equal(a.input.positions.find(p=>p.code==='300750').quantity,'100'); // No simulated write.
});
test('missing price or cash never fabricates weight, shock or low-risk status',async()=>{
  const p=input();p.cash_total=null;p.cash_available=null;
  for(const a of [await analyze(p),await analyze(input(),facts().slice(1))]){
    assert.equal(a.risk.state,'partial');assert.deepEqual(a.risk.shocks,[]);
    assert.equal(a.risk.largest_position_pct,null);
    assert.equal(a.risk.dimensions.find(d=>d.id==='concentration').state,'data_pending');
  }
});
test('unconfigured limits remain observations, and total-position deviation has its own reason',async()=>{
  const p=input();p.policy={};p.targets_confirmed=false;
  let a=await analyze(p);assert.equal(a.risk.dimensions.find(d=>d.id==='concentration').state,'observation');
  assert.equal(a.risk.target_issue_count,0);
  p.policy={invested_max_pct:60};p.targets_confirmed=true;a=await analyze(p);
  assert.equal(a.risk.primary_dimension,'allocation');assert.match(a.risk.headline,/总仓位偏离/);
});
test('cash-only risk keeps securities shock zero without calling the entire account safe',async()=>{
  const p=input();p.positions=[];
  const a=await analyze(p,[]);assert.match(a.risk.headline,/现金组合/);
  assert.equal(a.risk.shocks[0].estimated_change_amount,0);assert.equal(a.risk.shocks[0].cash_after,20000);
  assert.equal(a.risk.dimensions.find(d=>d.id==='research').state,'not_assessed');
});
