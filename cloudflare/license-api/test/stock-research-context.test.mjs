import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {boundStockBehavior} from '../src/stock-research-context.mjs';
import {stockDetailVisuals} from '../src/stock-detail-visuals.mjs';
import {stockRiskPortrait,marketRiskPortrait} from '../src/mobile-risk-portrait.mjs';
import {__mobilePresentationTest as p} from '../src/worker.js';
const code='002027',day='2026-10-13';
const details={trade_date:day,scores:{trend:64,technical:28.35,valuation:39.3125,fundamental:68.34,risk:72.6,momentum:0},
    behavior_profile:{code,industry:'传媒/文化',risk:{level:'high'},sector_lifecycle:{label:'未知'},capital_behavior:{label:'出货',kline_context:{pct_5d:7.822,pct_20d:3.448}},board_behavior:{volume_ratio:2.33,pct_change:0}}};
const row={code,_data_date:day,score_date:day,public_details:JSON.stringify(details)};
test('legacy profile is bound only by agreeing owner code and both business dates',()=>{
    assert.equal(boundStockBehavior({code,day,scoreRow:row,details}).trade_date,day);
    for(const bad of [{...row,code:'600036'},{...row,score_date:'2026-10-12'}])
        assert.deepEqual(boundStockBehavior({code,day,scoreRow:bad,details}),{});
    assert.deepEqual(boundStockBehavior({code,day,scoreRow:row,details:{...details,trade_date:'2026-10-12'}}),{});
    assert.deepEqual(boundStockBehavior({code,day,scoreRow:row,details:{...details,behavior_profile:{...details.behavior_profile,trade_date:'2026-10-12'}}}),{});
});
test('desktop radar axes retain actual zero momentum and risk resilience, never pressure inversion',()=>{
    const v=stockDetailVisuals({code,day,scoreRow:row,details});
    assert.deepEqual(v.radar.map(r=>r.key),['trend','technical','valuation','fundamental','risk','momentum']);
    assert.equal(v.radar.at(-1).value,0);assert.equal(v.radar[4].value,72.6);
    assert.equal(stockDetailVisuals({code,day,details:{scores:{risk:101}}}).radar[4].value,null);
});
test('real stock presenter binds missing profile date and supplies actual movement evidence',()=>{
    const result=p.mobileStockResearchPayload({code,sections:{quote:{trade_date:day,pct_change:0}}},row,{code,data_date:day});
    assert.equal(result.risk_portrait.groups.at(-1).level,'高');
    assert.equal(result.detail_visuals.movement.find(r=>r.key==='return_5d').value,7.822);
    assert.equal(result.detail_visuals.movement.find(r=>r.key==='volume_ratio').value,2.33);
    assert.equal(result.detail_visuals.movement[0].value,0);
});
test('stock risk uses same-day independent market readings, not the stock market-cycle proxy',()=>{
    const market=marketRiskPortrait({observation:{business_date:day,status:'ready',value:32},scoreRow:{risk_level:'high',market_phase:'弱势震荡'},
        sentimentRows:[{trade_date:day,up_count:52,total_count:100,limit_down_count:12}]});
    const result=stockRiskPortrait({code,day,marketPortrait:market,behavior:{code,trade_date:day,market_cycle:{risk_level:'low',score:99}}});
    assert.equal(result.groups[0].score,32);assert.equal(result.groups[0].level,'高');
    assert.equal(result.groups[0].items.find(i=>i.metric_id==='advancing_share').numeric_value,52);
    const future=stockRiskPortrait({code,day,marketPortrait:{...market,business_date:'2026-10-14'}});
    assert.equal(future.groups[0].score,null);
});
test('industry exact matching is required; unrelated comparison sectors are omitted from stock risk',()=>{
    const market=marketRiskPortrait({observation:{business_date:day},industryRows:[{trade_date:day,industry_name:'文化传媒',pct_change:-.13,company_count:128}]});
    const result=stockRiskPortrait({code,day,industry:'传媒/文化',marketPortrait:market});
    assert.equal(result.groups[1].score,null);assert.equal(result.groups[1].items.find(i=>i.title==='分类关联').value,'待核对');
    assert.equal(result.groups.filter(g=>g.scope==='industry').length,1);
    assert.equal(result.groups.some(g=>g.title==='行业对照 · 文化传媒'),false);
    const exact=stockRiskPortrait({code,day,industry:'文化传媒',marketPortrait:market});
    assert.equal(exact.groups[1].title,'文化传媒');assert.equal(exact.groups[1].items.find(i=>i.metric_id==='industry_company_count').numeric_value,128);
    assert.equal(exact.groups[1].score,null);
});
test('shared public context reads enforce exact day before LIMIT, including observed zero',async()=>{
    const db=new DatabaseSync(':memory:');
    try {
        db.exec(`CREATE TABLE production_upload_batches(batch_id TEXT,status TEXT);
        CREATE TABLE production_table_rows(table_name TEXT,row_key TEXT,row_hash TEXT,row_json TEXT,data_date TEXT,
            edition_scope TEXT,module TEXT,batch_id TEXT,updated_at TEXT);
        INSERT INTO production_upload_batches VALUES('ok','committed'),('pending','staging');`);
        for(const table of ['market_score_daily','market_sentiment_daily','market_fund_flow_cache','industry_fund_flow_cache']) {
            for(const [date,edition,batch] of [[day,'pro','ok'],['2026-10-14','pro','ok'],[day,'internal','ok'],[day,'pro','pending']])
                db.prepare('INSERT INTO production_table_rows VALUES(?,?,?,?,?,?,?,?,?)').run(table,`${date}${edition}${batch}`,'hash',
                    JSON.stringify({trade_date:date,market_score:0,data_source:'unit',industry_name:'行业'}),date,edition,'market_context',batch,date+'T20:00:00');
            const env={DB:{prepare(sql){return {bind(...args){return {all:async()=>({results:db.prepare(sql).all(...args)})};}};}}};
            const rows=await p.publishedRows(env,table,{edition:'personal_pro'},{data_date:day,limit:1});
            assert.equal(rows.length,1);assert.equal(rows[0].trade_date,day);assert.equal(rows[0].market_score,0);
        }
    } finally {db.close();}
});
