import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeIndustryEvidenceRows,stockRiskPortrait,marketRiskPortrait} from '../src/mobile-risk-portrait.mjs';
import {loadPublishedIndustryContext} from '../src/mobile-industry-context.mjs';
import {__mobilePresentationTest as presentation} from '../src/worker.js';
import {DatabaseSync} from 'node:sqlite';
const day='2026-10-08',code='600519';
const profile={code,trade_date:day,risk:{level:'high',flags:['价格破位需关注','Traceback exception: never expose']},
  market_cycle:{score:88,label:'震荡',risk_level:'medium'},sector_lifecycle:{score:95,label:'退潮',risk_flags:['板块承接减弱']}};
const metrics={trade_date:day,symbol:code,data_source:'derived_daily_bar',risk_score:0,
  volatility_20:2.3,volatility_60:1.8,max_drawdown_20:-.15,max_drawdown_60:-.22,extreme_down_days_20:0};
test('stock portrait preserves zero pressure and physical units, not percentile resilience',()=>{
  const value=stockRiskPortrait({code,day,behavior:profile,riskMetrics:metrics,industry:'消费'});
  assert.equal(value.groups[0].score,null);assert.equal(value.groups[1].score,null);
  const stock=value.groups[2];assert.equal(stock.score,0);assert.equal(stock.score_kind,'price_pressure');
  assert.equal(stock.items.find(i=>i.title==='20日最大回撤').value,'-15%');
  assert.equal(stock.items.find(i=>i.metric_id==='max_drawdown_20').numeric_value,-15);
  assert.equal(stock.items.find(i=>i.metric_id==='max_drawdown_60').numeric_value,-22);
  assert.equal(stock.items.find(i=>i.metric_id==='volatility_60').unit,'%');
  assert.equal(stock.items.find(i=>i.title==='20日大跌天数').value,'0天');
  assert.match(stock.summary,/近20日最大回撤-15%，60日-22%/);
  assert.match(stock.summary,/2.3%，高于60日的1.8%/);
  assert.doesNotMatch(JSON.stringify(value),/Traceback|exception|data_source|derived_daily_bar|88|95/);
});

test('typed risk charts omit unknown/invalid measures and preserve observed zero',()=>{
  const stock=stockRiskPortrait({code,day,riskMetrics:{...metrics,volatility_60:-1,max_drawdown_60:1}}).groups[2];
  assert.equal(stock.items.some(i=>i.metric_id==='volatility_60'),false);
  assert.equal(stock.items.some(i=>i.metric_id==='max_drawdown_60'),false);
  assert.equal(stock.items.find(i=>i.metric_id==='extreme_down_days_20').numeric_value,0);
});
test('stock risk portrait carries all six unlock metrics without converting missing values to zero',()=>{
  const unlockProfile={...profile,risk:{...profile.risk,unlock_risk:{available:true,event_date:'2026-10-18',
    effective_unlock_shares:2000000,unlock_market_value:2600000000,unlock_float_share_ratio:5,
    unlock_pressure_score:70,days_to_unlock:10,unlock_concentration:62.5,metric_status:'ready',missing_is_not_zero:true}}};
  const stock=stockRiskPortrait({code,day,behavior:unlockProfile,riskMetrics:metrics}).groups[2];
  for(const id of ['effective_unlock_shares','unlock_market_value','unlock_float_share_ratio','unlock_pressure_score','days_to_unlock','unlock_concentration'])
    assert.ok(stock.items.find(item=>item.metric_id===id),id);
  assert.equal(stock.items.find(item=>item.metric_id==='effective_unlock_shares').numeric_value,2000000);
  assert.equal(stock.items.find(item=>item.metric_id==='unlock_pressure_score').value,'70分');
  assert.match(stock.summary,/解禁压力70分，占流通股5%，距解禁10天/);

  const partial=stockRiskPortrait({code,day,behavior:{...profile,risk:{...profile.risk,unlock_risk:{available:true,
    event_date:'2026-10-18',unlock_pressure_score:null,metric_status:'partial',missing_is_not_zero:true}}}}).groups[2];
  assert.equal(partial.items.some(item=>item.metric_id==='unlock_pressure_score'),false);
});
test('stock identity, exact day and known metric units are required; never use latest or unknown source',()=>{
  for(const changes of [{trade_date:'2026-10-09'},{symbol:'000858'},{data_source:'unknown'},{risk_score:true}]) {
    const g=stockRiskPortrait({code,day,behavior:{...profile,code:'000858'},riskMetrics:{...metrics,...changes}}).groups;
    assert.equal(g[0].level,'待评估');assert.equal(g[2].score,null);
  }
  assert.deepEqual(stockRiskPortrait({code,day:'invalid'}).groups,[]);
});
test('market environment score is not inverted risk score; dated industry and missing scores stay separate',()=>{
  const p=marketRiskPortrait({observation:{business_date:day,status:'ready',value:80},scoreRow:{risk_level:'low',market_phase:'震荡'},
    sentimentRows:[{trade_date:'2026-10-09',up_count:100,total_count:100},{trade_date:day,up_count:0,total_count:100,limit_down_count:0}],
    flowRows:[{trade_date:'2026-10-07',main_net:999}],capitalValue:()=>'+99亿元',
    industryRows:[{trade_date:'2026-10-07',industry_name:'银行',risk_score:92,hot_score:95,pct_change:-2}],industryValue:()=> '--'});
  assert.equal(p.groups[0].score,80);assert.equal(p.groups[0].score_kind,'market_environment');
  assert.equal(p.groups[0].items.find(i=>i.title==='上涨家数占比').value,'0%');
  assert.equal(p.groups[0].items.some(i=>i.title==='主力资金净额'),false);
  assert.equal(p.groups[1].business_date,'2026-10-07');assert.equal(p.groups[1].score,null);
  const blocked=marketRiskPortrait({observation:{business_date:day,status:'blocked',value:80},scoreRow:{risk_level:'high'}});
  assert.equal(blocked.groups[0].score,null);assert.equal(blocked.groups[0].level,'待评估');
});
test('exact-day flow is formatted from its own row, never an unrelated newest net',()=>{
  const p=marketRiskPortrait({observation:{business_date:day},flowRows:[
    {trade_date:'2026-10-09',main_net:999},{trade_date:day,main_net:0}],capitalValue:v=>v===undefined?'--':`${v}元`});
  assert.equal(p.groups[0].items.find(i=>i.title==='主力资金净额').value,'0元');
});
test('industry score needs an explicit producer score direction, not heat or lifecycle strength',()=>{
  const p=marketRiskPortrait({observation:{business_date:day},industryRows:[{trade_date:day,industry_name:'电气',
    risk_score_kind:'risk_pressure_0_100_higher_is_worse',risk_score:65,risk_level:'high'}]});
  assert.equal(p.groups[1].score,65);assert.equal(p.groups[1].level,'高');
});
test('formal member and risk rows enrich only one exact same-day DC industry identity',()=>{
  const flows=[{trade_date:day,industry_name:'租赁',data_source:'tushare_moneyflow_ind_dc',pct_change:-1.11,net_amount:-7310000},
    {trade_date:day,industry_name:'银行',data_source:'tushare_moneyflow_ind_dc',pct_change:.2}];
  const members=[{business_date:day,industry_name:'租赁',data_source:'tushare:moneyflow_ind_dc:industry',data_quality_status:'ready',observation_status:'available',
    member_count:12,lead_stock:'渤海租赁',lead_stock_pct:3.5},
    {business_date:'2026-10-09',industry_name:'银行',data_source:'tushare:moneyflow_ind_dc:industry',data_quality_status:'ready',member_count:99}];
  const risks=[{business_date:day,industry_name:'租赁',data_source:'tushare:moneyflow_ind_dc:industry',validation_status:'ready',
    risk_score_kind:'risk_pressure_0_100_higher_is_worse',risk_score:67.4,risk_level:'high',confidence:.91}];
  const merged=mergeIndustryEvidenceRows(flows,members,risks,day);
  assert.equal(merged[0].company_count,12);assert.equal(merged[0].lead_stock,'渤海租赁');
  assert.equal(merged[0].risk_score,67.4);assert.equal(merged[0].risk_level,'high');
  assert.equal(merged[1].company_count,undefined);assert.equal(merged[1].risk_score,undefined);
});
test('ambiguous duplicate formal evidence fails closed instead of picking a latest row',()=>{
  const flow=[{trade_date:day,industry_name:'租赁',data_source:'tushare_moneyflow_ind_dc'}];
  const duplicate=[{business_date:day,industry_name:'租赁',data_source:'tushare:moneyflow_ind_dc:industry',data_quality_status:'ready',member_count:12},
    {business_date:day,industry_name:'租赁',data_source:'tushare:moneyflow_ind_dc:industry',data_quality_status:'ready',member_count:13}];
  assert.equal(mergeIndustryEvidenceRows(flow,duplicate,[],day)[0].company_count,undefined);
});
test('same-name non-DC partition cannot consume DC member or risk evidence',()=>{
  const flow=[{trade_date:day,industry_name:'租赁',data_source:'akshare:ths_stock_fund_flow_industry'}];
  const members=[{business_date:day,industry_name:'租赁',data_source:'tushare:moneyflow_ind_dc:industry',
    data_quality_status:'ready',member_count:12}];
  assert.equal(mergeIndustryEvidenceRows(flow,members,[],day)[0].company_count,undefined);
});
test('one validated risk row remains consumable beside a withheld research row',()=>{
  const flow=[{trade_date:day,industry_name:'租赁',data_source:'tushare_moneyflow_ind_dc'}];
  const risks=[
    {business_date:day,industry_name:'租赁',data_source:'tushare:moneyflow_ind_dc:industry',
      validation_status:'research_pending',risk_score_kind:'risk_pressure_0_100_higher_is_worse'},
    {business_date:day,industry_name:'租赁',data_source:'tushare:moneyflow_ind_dc:industry',
      validation_status:'ready',risk_score_kind:'risk_pressure_0_100_higher_is_worse',
      risk_score:67.4,risk_level:'high',confidence:.91},
  ];
  assert.equal(mergeIndustryEvidenceRows(flow,[],risks,day)[0].risk_score,67.4);
});
test('shared industry context selects flow business day before reading formal evidence',async()=>{
  const calls=[];
  const rows={
    industry_fund_flow_cache:[
      {trade_date:'2026-10-07',industry_name:'旧行业',data_source:'tushare_moneyflow_ind_dc'},
      {trade_date:day,sector_code:'BK1234.DC',industry_name:'租赁',data_source:'tushare_moneyflow_ind_dc'},
    ],
    industry_member_observation_daily:[{business_date:day,industry_name:'租赁',
      data_source:'tushare:moneyflow_ind_dc:industry',data_quality_status:'ready',member_count:12}],
    sector_classification_snapshots:[{business_date:day,classification_id:'SCLASS-1',
      sector_entity_id:'SECTOR-1',source_sector_code:'BK1234.DC',sector_type:'industry',
      sector_type_label:'行业板块',classification_status:'cross_industry',
      classification_label:'跨行业板块',mapping_semantics:'one_to_many',
      top_industries_json:JSON.stringify([{canonical_industry_id:'I1',canonical_industry_name:'租赁和商务服务',member_weight:.6}])}],
    industry_risk_daily:[],
  };
  const result=await loadPublishedIndustryContext({read:async(table,options)=>{
    calls.push([table,options]);return rows[table]||[];
  }});
  assert.equal(result.business_date,day);assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].company_count,12);
  assert.equal(result.rows[0].sector_classification_label,'跨行业板块');
  assert.equal(result.rows[0].canonical_industry_top3[0].member_weight,.6);
  assert.deepEqual(calls.slice(1).map(call=>call[1].data_date),[day,day,day]);
});
test('cross-industry sector is labelled and its Top3 composition is shown without a fake risk score',()=>{
  const result=marketRiskPortrait({observation:{business_date:day},industryRows:[{
    trade_date:day,industry_name:'综合服务',sector_type_label:'行业板块',mapping_semantics:'one_to_many',
    canonical_industry_top3:[
      {canonical_industry_name:'商务服务',member_weight:.55},
      {canonical_industry_name:'交通运输',member_weight:.3},
    ],
  }]}).groups[1];
  assert.equal(result.score,null);
  assert.equal(result.items.find(item=>item.title==='板块类型').value,'行业板块');
  assert.match(result.items.find(item=>item.title==='Top3 行业构成').value,/商务服务 55%/);
  assert.match(result.summary,/跨多个统一行业/);
});
test('industry assessment gap is explicit and existing source facts are filled without inventing risk',()=>{
  const result=marketRiskPortrait({observation:{business_date:day},industryRows:[{trade_date:day,industry_name:'电网设备',pct_change:-.13,
    net_amount:-93000000,company_count:128,lead_stock:'来源领涨股',lead_stock_pct:0}],industryValue:()=>'-9300万元'}).groups[1];
  assert.equal(result.assessment_status,'partial');assert.equal(result.score,null);assert.equal(result.level,'待评估');
  assert.deepEqual(result.missing_dimensions,['独立风险等级','独立风险压力分']);
  assert.equal(result.items.find(i=>i.metric_id==='industry_company_count').numeric_value,128);
  assert.equal(result.items.find(i=>i.metric_id==='industry_leader_return').numeric_value,0);
  assert.match(result.summary,/缺失不代表低风险/);
  const invalid=marketRiskPortrait({observation:{business_date:day},industryRows:[{trade_date:day,industry_name:'行业',company_count:0,lead_stock_pct:2}]}).groups[1];
  assert.equal(invalid.items.some(i=>i.metric_id==='industry_company_count'),false);
  assert.equal(invalid.items.some(i=>i.metric_id==='industry_leader_return'),false);
});
test('newer industry observations cannot invalidate or be joined into an earlier market day',()=>{
  const p=marketRiskPortrait({observation:{business_date:day,status:'ready',value:50},industryRows:[
    {trade_date:'2026-10-09',industry_name:'未来行业',pct_change:1},{trade_date:day,industry_name:'同日行业',pct_change:0}]});
  assert.deepEqual(p.groups.map(g=>g.title),['大盘风险','同日行业']);
});
test('actual stock/market presenters include optional risk envelope without exposing private material',()=>{
  const p=presentation.mobileStockResearchPayload({code,sections:{risk_metrics:metrics}},
    {_data_date:day,risk_score:95,public_details:JSON.stringify({behavior_profile:profile})},{code,data_date:day});
  assert.equal(p.risk_portrait.groups[2].score,0);
  const empty=presentation.mobileStockResearchPayload({code}, {_data_date:day,risk_score:95},{code,data_date:day});
  assert.equal(empty.risk_portrait.groups[2].score,null);assert.equal(empty.header.risk_label,'待评估');
  const market=presentation.mobileMarketCenterPayload({scoreRows:[{trade_date:day,market_score:0,risk_level:'high'}]});
  assert.equal(market.risk_portrait.groups[0].score,0);assert.equal(market.risk_portrait.groups[0].score_kind,'market_environment');
});
test('historical published risk read applies the date fence before limit and rejects staging and edition leakage',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE production_upload_batches(batch_id TEXT,status TEXT);
      CREATE TABLE production_table_rows(table_name TEXT,row_key TEXT,row_hash TEXT,row_json TEXT,data_date TEXT,
        edition_scope TEXT,module TEXT,batch_id TEXT,updated_at TEXT);
      INSERT INTO production_upload_batches VALUES('ready','committed'),('pending','staging');`);
    for(const [date,scope,batch] of [[day,'pro','ready'],['2026-10-09','pro','ready'],[day,'internal','ready'],[day,'pro','pending']])
      db.prepare('INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)').run('stock_risk_metrics',`${date}${scope}${batch}`,'hash',
        JSON.stringify({symbol:code,trade_date:date,risk_score:70}),date,scope,'market_context',batch,`${date}T20:00:00`);
    const env={DB:{prepare(sql){return {bind(...args){return {all:async()=>({results:db.prepare(sql).all(...args)})};}};}}};
    const values=await presentation.publishedRows(env,'stock_risk_metrics',{edition:'personal_pro'},
      {as_of_date:day,asset_codes:[code],limit:1});
    assert.equal(values.length,1);assert.equal(values[0].trade_date,day);assert.equal(values[0]._edition_scope,'pro');
  } finally {db.close();}
});
