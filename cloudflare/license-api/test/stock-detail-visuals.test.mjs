import test from 'node:test';
import assert from 'node:assert/strict';
import {financialDisplayInputs,financialStatementInputs,stockDetailVisuals} from '../src/stock-detail-visuals.mjs';
const code='002027',day='2026-10-13';
const financial={code,report_date:'2026-06-30',report_publish_date:'2026-08-19',data_available_date:'2026-10-09',
  data_source:'tushare_fina_indicator',roe:22.1537,eps:.2166,profit_growth:17.3852,revenue_growth:-1.9793,
  raw_payload:JSON.stringify({ts_code:'002027.SZ',end_date:'20260630',ann_date:'20260819',grossprofit_margin:70.5382,
    netprofit_margin:52.0466,debt_to_assets:35.6421,current_ratio:2.0506,quick_ratio:2.0493,ocfps:.3084})};
test('exact financial source identity and availability unlock existing raw measures, not missing totals',()=>{
  const v=stockDetailVisuals({code,day,financial});
  const by=Object.fromEntries(v.financial.map(r=>[r.key,r]));
  assert.equal(by.gross_margin.value,70.5382);assert.equal(by.ocfps.value,.3084);
  assert.equal(by.revenue.value,null);assert.equal(by.net_profit.value,null);
  assert.equal(by.roe.group,'profitability');assert.equal(by.revenue_growth.group,'growth');
  assert.equal(by.ocfps.unit,'元/股');assert.equal(v.report_date,'2026-06-30');
  assert.doesNotMatch(JSON.stringify(v),/raw_payload|ts_code|data_source/);
});
test('raw identity, report, announcement and known availability are all required',()=>{
  for(const f of [{...financial,data_source:'unknown'},{...financial,report_publish_date:''},{...financial,data_available_date:''},
    {...financial,raw_payload:financial.raw_payload.replace('002027.SZ','600519.SH')},
    {...financial,raw_payload:financial.raw_payload.replace('20260630','20260331')}]) {
    assert.equal(financialDisplayInputs(f,code,day).grossprofit_margin,null);
  }
  for(const f of [{...financial,code:'600519'},{...financial,report_date:'2026-12-31'},
    {...financial,report_publish_date:'2026-10-14'},{...financial,data_available_date:'2026-10-14'}])
    assert.deepEqual(financialDisplayInputs(f,code,day),{});
});
test('Tushare gross_margin is an amount and cannot substitute grossprofit_margin percentage',()=>{
  const v=stockDetailVisuals({code,day,financial:{code,report_date:'2026-06-30',gross_margin:90000000}});
  assert.equal(v.financial.find(r=>r.key==='gross_margin').value,null);
});
test('financial history retains published period YoY values only, not fabricated sequential growth',()=>{
  const a={...financial,report_date:'2026-03-31',report_publish_date:'2026-04-20',data_available_date:'2026-10-09',revenue_growth:0,
    raw_payload:JSON.stringify({ts_code:'002027.SZ',end_date:'20260331',ann_date:'20260420'})};
  const future={...financial,report_publish_date:'2026-10-14'};
  const value=stockDetailVisuals({code,day,financial:{...financial,history:[financial,a,future]}});
  assert.deepEqual(value.financial_history.map(p=>p.period),['2026-03-31','2026-06-30']);
  assert.equal(value.financial_history[0].revenue_growth,0);
  const conflicted=stockDetailVisuals({code,day,financial:{...financial,history:[a,{...a,revenue_growth:99}]}});
  assert.deepEqual(conflicted.financial_history,[]);
});
test('three statements are joined on one report period and expose cash quality without raw rows',()=>{
  const statement_rows={
    income:[{code:'002027.SZ',report_date:'2026-06-30',total_revenue:200,operating_cost:120,operating_profit:50,parent_net_profit:40,
      raw_payload:JSON.stringify({ann_date:'20260819'})}],
    cashflow:[{code,report_date:'2026-06-30',operating_cashflow:60,net_cash_increase:12,raw_payload:{ann_date:'2026-08-19'}}],
    balance:[{code,report_date:'2026-06-30',total_assets:500,total_liabilities:200,current_assets_total:180,
      current_liabilities_total:90,inventory:30,monetary_funds:45,raw_payload:JSON.stringify({ann_date:'20260819'})}],
  };
  const summary=financialStatementInputs(statement_rows,code,day);
  assert.equal(summary.gross_margin,40);assert.equal(summary.operating_margin,25);
  assert.equal(summary.cash_conversion,150);assert.equal(summary.current_ratio,2);
  assert.equal(summary.cash_to_current_liabilities,.5);assert.equal(summary.financial_confidence,'高');
  assert.match(summary.financial_conclusion,/含金量较强/);
  const v=stockDetailVisuals({code,day,financial:{code,statement_rows}});
  const by=Object.fromEntries(v.financial.map(row=>[row.key,row.value]));
  assert.equal(v.report_date,'2026-06-30');assert.equal(by.operating_cashflow,60);
  assert.equal(by.cash_to_current_liabilities,.5);assert.equal(v.financial_confidence,'高');
  assert.doesNotMatch(JSON.stringify(v),/statement_rows|raw_payload|ann_date/);
});
test('future-announced rows and cross-period substitutions are rejected',()=>{
  const rows={
    income:[
      {code,report_date:'2026-09-30',total_revenue:999,raw_payload:{ann_date:'2026-10-14'}},
      {code,report_date:'2026-06-30',total_revenue:200,net_profit:40,raw_payload:{ann_date:'2026-08-19'}},
    ],
    cashflow:[
      {code,report_date:'2026-09-30',operating_cashflow:999,raw_payload:{ann_date:'2026-10-14'}},
      {code,report_date:'2026-03-31',operating_cashflow:60,raw_payload:{ann_date:'2026-04-20'}},
    ],
  };
  const value=financialStatementInputs(rows,code,day);
  assert.equal(value.statement_report_date,'2026-06-30');
  assert.equal(value.revenue,200);assert.equal(value.operating_cashflow,null);
  assert.deepEqual(value.statement_coverage,['income']);
});
test('statement projection fails closed when stock identity is absent or mismatched',()=>{
  const rows={income:[
    {report_date:'2026-06-30',revenue:999},
    {code:'600519.SH',report_date:'2026-06-30',revenue:999},
  ]};
  assert.deepEqual(financialStatementInputs(rows,code,day),{});
});
test('statement rows survive an unavailable summary metric row',()=>{
  const v=stockDetailVisuals({code,day,financial:{code,report_date:'2026-12-31',statement_rows:{
    income:[{code,report_date:'2026-06-30',revenue:100,net_profit:10,raw_payload:{ann_date:'2026-08-19'}}],
    cashflow:[{code,report_date:'2026-06-30',operating_cashflow:10,raw_payload:{ann_date:'2026-08-19'}}],
  }}});
  assert.equal(v.report_date,'2026-06-30');
  assert.equal(v.financial.find(row=>row.key==='cash_conversion').value,100);
});
test('score dimensions preserve real zero, reject nonfinite/out-of-range and never relabel risk resilience',()=>{
  const v=stockDetailVisuals({code,day,scoreRow:{code,technical_score:0,fundamental_score:105,risk_score:95},
    capital:{label:'温和流入'},sector:{label:'修复'}});
  assert.equal(v.dimensions[0].value,0);assert.equal(v.dimensions[1].value,null);
  assert.ok(!v.dimensions.some(r=>r.key==='risk'));assert.equal(v.labels[2].value,'-');
  assert.ok(stockDetailVisuals({code,day,scoreRow:{code:'600519',technical_score:90}}).dimensions.every(r=>r.value===null));
});
