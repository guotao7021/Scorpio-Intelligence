import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {stockRiskPortrait,marketRiskPortrait} from '../src/mobile-risk-portrait.mjs';
import {TRAP_CATALOG} from '../src/mobile-trap-catalog.mjs';
import {mobileTrapSignals} from '../src/mobile-risk-details.mjs';
import {boardPopulationQuery,boardRiskSegments} from '../src/mobile-board-risk.mjs';

const day='2026-10-30',code='000001',hash='sha256:'+'a'.repeat(64);
const snapshot={version:'mobile-stock-signals.v1',code,business_date:day,batch_id:'SCB-'+'b'.repeat(32),
  source_hash:hash,input_revision_hash:hash,policy_hash:hash,known_at:'2026-11-01T01:00:00+08:00',
  display_only:true,orders_authorized:false,production_release_authorized:false,
  rules:TRAP_CATALOG.map(r=>({rule_id:r.id,implementation:r.implemented?'implemented':'deferred',
    data_status:r.implemented?'complete':'missing',calibration_status:'unvalidated_research',
    assessment:r.implemented?'not_triggered':'not_assessed'}))};

test('own industry does not borrow unrelated sectors when exact association is absent or duplicated',()=>{
  const market=marketRiskPortrait({observation:{business_date:day},industryRows:[
    {trade_date:day,industry_name:'煤炭'},{trade_date:day,industry_name:'半导体'}]});
  let result=stockRiskPortrait({code,day,industry:'银行',marketPortrait:market});
  assert.equal(result.groups.filter(g=>g.scope==='industry').length,1);
  assert.doesNotMatch(JSON.stringify(result),/煤炭|半导体|行业对照/);
  market.groups.push({...market.groups[1],title:'银行'},{...market.groups[1],title:'银行'});
  result=stockRiskPortrait({code,day,industry:'银行',marketPortrait:market});
  assert.equal(result.groups.filter(g=>g.scope==='industry').length,1);
  assert.equal(result.dimensions.length,6);
  assert.equal(result.dimensions.find(d=>d.id==='industry').score,null);
});

test('dimension values retain physical units, incomplete coverage and no synthetic total',()=>{
  const p=stockRiskPortrait({code,day,riskMetrics:{symbol:code,trade_date:day,data_source:'derived_daily_bar',
    risk_score:0,volatility_20:2.4,max_drawdown_20:-.3,avg_turnover_20:0,liquidity_amount_20:120000000,liquidity_amount_unit:'CNY'}});
  const find=id=>p.dimensions.find(d=>d.id===id);
  assert.equal(find('price').score,0);assert.equal(find('price').assessment_status,'partial');
  assert.equal(find('price').items[0].numeric_value,-30);
  assert.equal(find('liquidity').assessment_status,'observed');
  assert.equal(find('liquidity').items.find(i=>i.metric_id==='liquidity_amount_20').unit,'元');
  assert.equal(p.groups.find(g=>g.scope==='stock').items.some(i=>i.metric_id==='liquidity_amount_20'),false);
  assert.equal(find('supply').score,null);assert.equal(find('supply').assessment_status,'missing');
  assert.equal(p.dimensions.filter(d=>d.score!==null).length,1);
});

test('liquidity amount without a proved money unit is missing, never assumed yuan or rescaled',()=>{
  for(const unit of [undefined,'unknown','千元','USD']) {
    const value=stockRiskPortrait({code,day,riskMetrics:{symbol:code,trade_date:day,data_source:'derived_daily_bar',
      avg_turnover_20:0,liquidity_amount_20:120000,liquidity_amount_unit:unit}});
    const dimension=value.dimensions.find(d=>d.id==='liquidity');
    assert.equal(dimension.items.some(i=>i.metric_id==='liquidity_amount_20'),false);
    assert.equal(dimension.assessment_status,'partial');
    assert.equal(dimension.items.find(i=>i.metric_id==='avg_turnover_20').numeric_value,0);
  }
});

test('financial risk context requires own code, report period, announcement and actual known date',()=>{
  const financial={code,report_date:'2026-09-30',report_publish_date:'2026-10-29',data_available_date:day,
    debt_to_assets:72,current_ratio:0.9,operating_cashflow_per_share:-0.3};
  const read=f=>stockRiskPortrait({code,day,financial:f}).dimensions.find(d=>d.id==='events');
  assert.equal(read(financial).items.length,3);assert.equal(read(financial).score,null);
  assert.equal(read(financial).items.at(-1).numeric_value,-0.3);
  for(const patch of [{code:'600519'},{report_publish_date:'2026-11-01'},{data_available_date:'2026-11-01'},
    {report_publish_date:''},{report_date:'2026-12-31'}]) assert.equal(read({...financial,...patch}).items.length,0);
});

test('22 structured rules keep a research trigger distinct from high-danger and unassessed',()=>{
  const value=structuredClone(snapshot);value.rules[0].assessment='triggered';
  const rows=mobileTrapSignals({snapshot:value,code,day});
  assert.equal(rows.length,22);assert.equal(rows[0].state,'triggered');
  assert.equal(rows[1].state,'not_triggered');
  assert.equal(rows.find(r=>r.id==='spoofing_like_cancellation').state,'not_assessed');
  assert.equal(rows[0].source_hash,hash);assert.match(rows[0].summary,/研究代理/);
  assert.doesNotMatch(JSON.stringify(rows),/高危|已确认操纵/);
});

for(const [name,patch] of Object.entries({code:{code:'600519'},day:{business_date:'2026-10-29'},
  future:{known_at:'2099-01-01T00:00:00Z'},naive:{known_at:'2026-11-01T00:00:00'},
  hash:{source_hash:'bad'},authority:{orders_authorized:true},missing:{rules:[]},
  duplicate:{rules:snapshot.rules.map((r,i)=>i===1?snapshot.rules[0]:r)}})) {
  test(`invalid signal ${name} cannot become a clear or triggered result`,()=>{
    assert.ok(mobileTrapSignals({snapshot:{...snapshot,...patch},code,day}).every(r=>r.state==='not_assessed'));
  });
}

const info=(c,board)=>({table_name:'stock_info',code:c,board,list_date:'2020-01-01',data_date:day,listing_status:'L'});
const metric=(c,n)=>({table_name:'stock_risk_metrics',code:c,risk_score:n,data_date:day,trade_date:day,
  data_source:'derived_daily_bar',score_type:typeof n==='number'?'real':'null'});

test('three boards score absolute price pressure with coverage, preserving zero and excluding unknown identities',()=>{
  const rows=[info('000001','主板'),info('000002','主板'),info('300001','创业板'),info('688001','科创板'),
    info('302001','SZ'),metric('000001',0),metric('000002',100),metric('300001',null),metric('688001',70),metric('302001',99)];
  const segments=boardRiskSegments(rows,day);
  assert.deepEqual(segments.map(r=>r.score),[50,null,70]);
  assert.deepEqual(segments.map(r=>r.population_count),[2,1,1]);
  assert.equal(segments[1].sample_count,0);assert.equal(segments[1].coverage_pct,0);
  assert.equal(segments[1].assessment_status,'missing');
  assert.equal(segments[0].score_kind,'price_pressure_mean');
  assert.equal(segments[0].unclassified_count,1);
  assert.ok(boardRiskSegments(rows,day,{complete:false}).every(r=>r.score===null));
});

test('stale, conflicting, future metadata and percentile resilience do not enter board scores',()=>{
  const segments=boardRiskSegments([info('000001','主板'),metric('000001',20),metric('000001',30),
    info('000002','主板'),{...metric('000002',15),data_source:'score_history'},
    {...info('000003','主板'),data_date:'2026-11-01'},metric('000003',1),
    info('000004','主板'),{...metric('000004',8),trade_date:'2026-10-29'}],day);
  assert.equal(segments[0].score,null);assert.equal(segments[0].population_count,3);assert.equal(segments[0].excluded_count,3);
});

test('SQL reads full authorized same-day population, resolving edition copies before counting',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE production_upload_batches(batch_id TEXT,status TEXT);
    CREATE TABLE production_table_rows(row_key TEXT,table_name TEXT,row_json TEXT,data_date TEXT,
      edition_scope TEXT,module TEXT,updated_at TEXT,row_hash TEXT,batch_id TEXT);`);
  db.prepare('INSERT INTO production_upload_batches VALUES(?,?)').run('b','committed');
  const put=db.prepare('INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<600;i++) {
    const c=String(i).padStart(6,'0');
    for(const scope of ['standard_pro','personal_pro']) {
      put.run('risk'+c,'stock_risk_metrics',JSON.stringify({symbol:c,trade_date:day,data_source:'derived_daily_bar',risk_score:i%100}),
        day,scope,'market_context',day,'hash','b');
      put.run(c,'stock_info',JSON.stringify({code:c,market:'主板',list_date:'2020-01-01',status:'L'}),
        day,scope,'target_research',day,'hash','b');
    }
  }
  const query=boardPopulationQuery({day,scopes:['personal_pro','standard_pro']});
  const rows=db.prepare(query.sql).all(...query.params);
  const board=boardRiskSegments(rows,day)[0];
  assert.equal(rows.length,1200);assert.equal(board.population_count,600);assert.equal(board.sample_count,600);
  assert.equal(board.score,49.5);db.close();
});
