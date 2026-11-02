import {businessDate,observedNumber} from './market-display-contract.mjs';

const BOARDS=[['main','主板'],['chinext','创业板'],['star','科创板']];
const boardId = v => ({'主板':'main','创业板':'chinext','科创板':'star'})[v]||null;
const code = v => typeof v==='string' && /^\d{6}$/.test(v) ? v : null;

// Resolve authorized edition copies BEFORE considering the population. This
// reader deliberately bypasses publishedRows' 500-row display limit.
export function boardPopulationQuery({day,scopes}) {
  if(!businessDate(day)||!scopes?.length||scopes.some(s=>typeof s!=='string')) throw Error('board_scope_required');
  const q=scopes.map(()=>'?').join(','), priority=scopes.map(()=> 'WHEN ? THEN ?').join(' ');
  return {sql:`WITH ranked AS (
    SELECT r.row_key,r.table_name,r.row_json,r.data_date,
      ROW_NUMBER() OVER(PARTITION BY r.table_name,r.module,r.row_key
        ORDER BY r.data_date DESC,CASE r.edition_scope ${priority} ELSE 99 END,r.updated_at DESC,r.row_hash) AS ordinal
    FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id
    WHERE b.status='committed' AND r.edition_scope IN (${q}) AND json_valid(r.row_json)
      AND ((r.table_name='stock_risk_metrics' AND r.module='market_context' AND r.data_date=?)
        OR (r.table_name='stock_info' AND r.module='target_research' AND r.data_date<=? AND r.data_date<>''))
  ) SELECT table_name,data_date,
    COALESCE(json_extract(row_json,'$.symbol'),json_extract(row_json,'$.code')) AS code,
    CASE WHEN json_extract(row_json,'$.listing_board_source')='bq_stock_basic_info.security_type'
      AND json_extract(row_json,'$.listing_board_available_on')<=?
      AND length(json_extract(row_json,'$.listing_board_source_hash'))=71
      AND substr(json_extract(row_json,'$.listing_board_source_hash'),1,7)='sha256:'
      AND substr(json_extract(row_json,'$.listing_board_source_hash'),8) NOT GLOB '*[^0-9a-f]*'
      THEN json_extract(row_json,'$.listing_board')
      WHEN json_extract(row_json,'$.market') IN ('主板','创业板','科创板','北交所') THEN json_extract(row_json,'$.market')
      ELSE NULL END AS board,
    json_extract(row_json,'$.data_source') AS data_source,
    json_extract(row_json,'$.trade_date') AS trade_date,
    json_extract(row_json,'$.list_date') AS list_date,
    json_extract(row_json,'$.status') AS listing_status,
    json_extract(row_json,'$.risk_score') AS risk_score,
    json_type(row_json,'$.risk_score') AS score_type
  FROM ranked WHERE ordinal=1 LIMIT 20001`,params:[...scopes.flatMap((s,i)=>[s,i]),...scopes,day,day,day]};
}

export function boardRiskSegments(rows,day,{complete=true}={}) {
  const result=BOARDS.map(([id,title])=>({id,title,business_date:day,score:null,score_kind:'price_pressure_mean',
    assessment_status:'missing',sample_count:0,population_count:0,coverage_pct:null,
    excluded_count:0,unclassified_count:0,summary:'同日个股价格压力均值；分数越高，样本价格压力越大。不是环境支持分或已准入市场风险模型。',
    missing_dimensions:['同日风险样本'],membership_basis:'published_stock_info_as_of_day'}));
  if(!complete||rows.length>20000||!businessDate(day)) return result;
  const infos=new Map(),metrics=new Map(),conflicts=new Set();
  for(const row of rows) {
    const c=code(row.code); if(!c) continue;
    const target=row.table_name==='stock_info'?infos:row.table_name==='stock_risk_metrics'?metrics:null;
    if(!target) continue;
    // Multiple source identities for one stock are ambiguity, not extra votes.
    if(target.has(c)) conflicts.add(`${row.table_name}:${c}`); else target.set(c,row);
  }
  const classified=new Set(),unclassified=new Set();
  for(const [c,info] of infos) {
    const board=result.find(r=>r.id===boardId(info.board));
    const listed=businessDate(info.list_date);
    if(conflicts.has(`stock_info:${c}`)||!businessDate(info.data_date)||info.data_date>day||
       !listed||listed>day||['D','delisted','退市'].includes(info.listing_status)) continue;
    if(!board) {
      if(['北交所','BSE'].includes(info.board)) classified.add(c); else unclassified.add(c);
      continue;
    }
    classified.add(c);
    board.population_count++;
    const metric=metrics.get(c), n=observedNumber(metric?.risk_score);
    if(!metric||conflicts.has(`stock_risk_metrics:${c}`)||metric.data_date!==day||businessDate(metric.trade_date)!==day||
      metric.data_source!=='derived_daily_bar'||!['integer','real'].includes(metric.score_type)||n===null||n<0||n>100) {
      board.excluded_count++;continue;
    }
    board.score=(board.score??0)+n;board.sample_count++;
  }
  for(const c of metrics.keys()) if(!classified.has(c)) unclassified.add(c);
  for(const row of result) {
    row.unclassified_count=unclassified.size;
    row.score=row.sample_count?Number((row.score/row.sample_count).toFixed(2)):null;
    row.coverage_pct=row.population_count?Number((100*row.sample_count/row.population_count).toFixed(2)):null;
    row.assessment_status=row.sample_count?(row.sample_count===row.population_count?'observed':'partial'):'missing';
    row.missing_dimensions=[...(row.excluded_count?['部分个股风险读数缺失或冲突']:[]),...(!row.sample_count?['同日风险样本']:[])];
  }
  return result;
}

export async function loadBoardRiskSegments(env,{day,scopes}) {
  try {
    const q=boardPopulationQuery({day,scopes});
    const response=await env.DB.prepare(q.sql).bind(...q.params).all();
    return boardRiskSegments(response.results||[],day);
  } catch { return boardRiskSegments([],day,{complete:false}); }
}
