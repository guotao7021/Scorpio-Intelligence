// Read-only projection of published observations. No new score, threshold or gate.
import {businessDate, observedNumber} from './market-display-contract.mjs';
import {stockRiskDimensions, mobileTrapSignals} from './mobile-risk-details.mjs';
import {publishedMarketFlow} from './market-flow-display.mjs';
import {RiskLevel, isKnownRiskLevel, normalizeRiskLevel, riskLevelLabel} from './risk-level-enum.mjs';

const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const score = v => { const n = observedNumber(v); return n !== null && n >= 0 && n <= 100 ? n : null; };
const level = v => riskLevelLabel(v,{style:'short',unknownLabel:'待评估'});
const text = v => {
  const s = typeof v === 'string' ? v.trim() : '';
  // Technical error messages/identities belong in diagnostics, not a risk card.
  return s && s.length <= 360 && !/[_=]|\b(?:tushare|ifind|proxy|traceback|sql|exception)\b/i.test(s) ? s : '';
};
const flags = v => (Array.isArray(v) ? v : []).map(text).filter(Boolean).slice(0,6);
const item = (title, value, reading) => ({title,value,reading});
const measured = (metric_id,title,value,reading,numeric_value,unit) =>
  ({...item(title,value,reading),metric_id,numeric_value,unit});
const number = (v, suffix='') => { const n=observedNumber(v); return n === null ? '待更新' : `${Number(n.toFixed(2))}${suffix}`; };
const compactChineseNumber = (v, kind='shares') => {
  const n=observedNumber(v);
  if(n===null) return '待更新';
  if(kind==='money') {
    if(Math.abs(n)>=1e8) return `${Number((n/1e8).toFixed(2))}亿元`;
    if(Math.abs(n)>=1e4) return `${Number((n/1e4).toFixed(2))}万元`;
    return `${Number(n.toFixed(2))}元`;
  }
  if(Math.abs(n)>=1e8) return `${Number((n/1e8).toFixed(2))}亿股`;
  if(Math.abs(n)>=1e4) return `${Number((n/1e4).toFixed(2))}万股`;
  return `${Number(n.toFixed(2))}股`;
};
const group = (scope,title,day,items=[],extras={}) => {
  const result={scope,title,business_date:day,score:null,score_kind:'none',level:'待评估',
    summary:'风险分尚未形成，可先查看已更新的细项。',items:items.slice(0,16),...extras};
  const assessed=normalizeRiskLevel(result.level)!==RiskLevel.UNKNOWN;
  result.assessment_status=result.score!==null && assessed?'ready':items.length?'partial':'missing';
  result.missing_dimensions=[...(!assessed?['独立风险等级']:[]),
    ...(result.score===null?[scope==='market'?'环境支持分':'独立风险压力分']:[])];
  return result;
};
const envelope = (owner,day,groups) => ({version:'mobile-risk-portrait.v1',owner,business_date:day,display_only:true,groups});

const exactIndustryEvidenceKey = (row, day) => {
  const date=businessDate(row.business_date||row.trade_date||row._data_date);
  const name=text(row.industry_name||row.sector_name||row.name);
  return date===day && name ? `${date}\u0000${name}` : '';
};

const uniqueEvidenceByKey = (rows, day) => {
  const values=new Map(), conflicts=new Set();
  for(const raw of rows||[]) {
    const row=object(raw),key=exactIndustryEvidenceKey(row,day);
    if(!key) continue;
    if(values.has(key)) conflicts.add(key); else values.set(key,row);
  }
  for(const key of conflicts) values.delete(key);
  return values;
};

const jsonArray = value => {
  if(Array.isArray(value)) return value;
  if(typeof value!=='string' || !value.trim()) return [];
  try { const parsed=JSON.parse(value); return Array.isArray(parsed)?parsed:[]; }
  catch { return []; }
};
const exactSectorCodeKey = (row,day) => {
  const date=businessDate(row?.business_date||row?.trade_date||row?._data_date);
  const code=String(row?.source_sector_code||row?.sector_code||row?.ts_code||'').trim().toUpperCase();
  return date===day && /^BK\d{4}\.DC$/.test(code)?`${date}\u0000${code}`:'';
};
const uniqueClassificationByCode = (rows,day) => {
  const values=new Map(),conflicts=new Set();
  for(const raw of rows||[]) {
    const row=object(raw),key=exactSectorCodeKey(row,day);
    if(!key) continue;
    if(values.has(key)) conflicts.add(key); else values.set(key,row);
  }
  for(const key of conflicts) values.delete(key);
  return values;
};

const DC_FLOW_SOURCES = new Set([
  'tushare_moneyflow_ind_dc',
  'tushare:moneyflow_ind_dc:industry',
  'industry_fund_flow_cache:tushare_moneyflow_ind_dc',
  'industry_fund_flow_cache:tushare:moneyflow_ind_dc:industry',
]);
const FORMAL_DC_SOURCE = 'tushare:moneyflow_ind_dc:industry';
const sourcesOf = row => [row?.source, row?.data_source].map(value=>String(value||'').trim()).filter(Boolean);
const isDcFlow = row => sourcesOf(row).some(source=>DC_FLOW_SOURCES.has(source));
const isFormalDcEvidence = row => sourcesOf(row).includes(FORMAL_DC_SOURCE);
const isReadyRisk = row => row.validation_status === 'ready' &&
  row.risk_score_kind === 'risk_pressure_0_100_higher_is_worse' &&
  score(row.risk_score) !== null &&
  isKnownRiskLevel(row.risk_level) && normalizeRiskLevel(row.risk_level)!==RiskLevel.UNKNOWN &&
  observedNumber(row.confidence) !== null && Number(row.confidence) >= 0 && Number(row.confidence) <= 1;

/** Exact same-day/same-name projection only; canonical mapping itself is code based. */
export function mergeIndustryEvidenceRows(flowRows=[],memberRows=[],riskRows=[],requestedDay='',classificationRows=[]) {
  const day=businessDate(requestedDay);
  if(!day) return [];
  // Invalid/non-formal rows cannot poison an otherwise unique formal row.
  // Multiple formally-ready rows for the same identity still fail closed.
  const members=uniqueEvidenceByKey((memberRows||[]).filter(isFormalDcEvidence),day);
  const risks=uniqueEvidenceByKey((riskRows||[]).filter(row=>isFormalDcEvidence(row)&&isReadyRisk(row)),day);
  const classifications=uniqueClassificationByCode(classificationRows,day);
  return (flowRows||[]).map(raw=>{
    const flow=object(raw),key=exactIndustryEvidenceKey(flow,day);
    if(!key || !isDcFlow(flow)) return flow;
    const member=members.get(key)||{},risk=risks.get(key)||{};
    const classification=classifications.get(exactSectorCodeKey(flow,day))||{};
    const memberReady=isFormalDcEvidence(member) &&
      ['ready','partial'].includes(String(member.data_quality_status||''));
    const leaderReady=memberReady && member.observation_status==='available';
    const riskReady=isFormalDcEvidence(risk) && isReadyRisk(risk);
    const classificationReady=Boolean(classification.classification_id) &&
      ['one_to_one','one_to_many','unresolved'].includes(String(classification.mapping_semantics||''));
    return {
      ...flow,
      ...(memberReady&&observedNumber(member.member_count)>0?{company_count:member.member_count}:{}),
      ...(leaderReady&&text(member.lead_stock)?{
        lead_stock:member.lead_stock,
        lead_stock_pct:member.lead_stock_pct,
        lead_stock_price:member.lead_stock_price,
      }:{}),
      ...(riskReady?{
        risk_score_kind:risk.risk_score_kind,
        risk_score:risk.risk_score,
        risk_level:normalizeRiskLevel(risk.risk_level),
        risk_confidence:risk.confidence,
      }:{}),
      ...(classificationReady?{
        sector_entity_id:classification.sector_entity_id,
        sector_classification_id:classification.classification_id,
        sector_type:classification.sector_type,
        sector_type_label:classification.sector_type_label,
        sector_classification_status:classification.classification_status,
        sector_classification_label:classification.classification_label,
        mapping_semantics:classification.mapping_semantics,
        dominant_canonical_industry_id:classification.dominant_canonical_industry_id,
        dominant_canonical_industry_name:classification.dominant_canonical_industry_name,
        canonical_industry_top3:jsonArray(classification.top_industries_json||classification.top_industries).slice(0,3),
        sector_tags:jsonArray(classification.tags_json||classification.tags).slice(0,8),
      }:{}),
    };
  });
}

export function stockRiskPortrait({code,day,behavior={},riskMetrics={},industry='',marketPortrait=null,signalSnapshot=null,financial={}}) {
  day=businessDate(day);
  if (!day) return envelope(code,'',[]);
  behavior=object(behavior); riskMetrics=object(riskMetrics);
  const sameProfile=businessDate(behavior.trade_date) === day && behavior.code === code;
  const risk=object(sameProfile ? behavior.risk : {});
  const sector=object(sameProfile ? behavior.sector_lifecycle : {});
  const market=object(sameProfile ? behavior.market_cycle : {});
  // stock_risk_metrics is an absolute price-pressure measure. score_history.risk_score
  // is a relative resilience/ranking factor and is deliberately NOT a fallback.
  const sameRisk=businessDate(riskMetrics.trade_date) === day && riskMetrics.symbol === code &&
    riskMetrics.data_source === 'derived_daily_bar';
  const metrics=sameRisk ? riskMetrics : {};
  const readings=[];
  for (const [field,title,unit,reading,scale] of [
    ['volatility_20','20日涨跌波动','%','数值越大，日涨跌变化越剧烈；不是年化波动率。',1],
    ['volatility_60','60日涨跌波动','%','与20日波动对照，观察近期起伏是否强于较长周期。',1],
    ['max_drawdown_20','20日最大回撤','%','反映近20个交易日从阶段高点回落的幅度。',100],
    ['max_drawdown_60','60日最大回撤','%','反映更长周期的回落压力，不等同本日跌幅。',100],
    ['extreme_down_days_20','20日大跌天数','天','日跌幅达到7%的交易日数量。',1],
    ['avg_turnover_20','20日平均换手','%','反映交易活跃程度，单独不能证明资金吸筹或派发。',1],
    ['liquidity_amount_20','20日平均成交额','元','反映已成交的交易容量，不代表盘口深度或保证可成交。',1],
  ]) {
    if(field==='liquidity_amount_20' && metrics.liquidity_amount_unit!=='CNY') continue;
    const n=observedNumber(metrics[field]);
    const valid=n!==null && (field.startsWith('max_drawdown') ? n>=-1 && n<=0 : n>=0) &&
      (field!=='extreme_down_days_20' || Number.isInteger(n) && n<=20);
    if (valid) readings.push(measured(field,title,number(n*scale,unit),reading,n*scale,unit));
  }
  const unlock=object(risk.unlock_risk);
  const unlockAvailable=Boolean(unlock.available);
  if(unlockAvailable) {
    const eventDate=businessDate(unlock.event_date);
    if(eventDate) readings.push(item('最近解禁日',eventDate,'展示当前数据日之后最近一笔已披露解禁事件。'));
    const shares=observedNumber(unlock.effective_unlock_shares);
    if(shares!==null && shares>=0) readings.push(measured('effective_unlock_shares','有效解禁股数',compactChineseNumber(shares),
      '按最新公告版本去重汇总的有效解禁数量。',shares,'股'));
    const value=observedNumber(unlock.unlock_market_value);
    if(value!==null && value>=0) readings.push(measured('unlock_market_value','解禁市值',compactChineseNumber(value,'money'),
      '按估值日收盘价计算；价格缺失时保持待更新。',value,'元'));
    const ratio=observedNumber(unlock.unlock_float_share_ratio);
    if(ratio!==null && ratio>=0) readings.push(measured('unlock_float_share_ratio','占流通股',number(ratio,'%'),
      '有效解禁股数占同日流通股本的比例。',ratio,'%'));
    const pressure=score(unlock.unlock_pressure_score);
    if(pressure!==null) readings.push(measured('unlock_pressure_score','解禁压力分',number(pressure,'分'),
      '0—100 分，越高表示近期解禁规模与占流通股比例带来的供给压力越大。',pressure,'分'));
    const days=observedNumber(unlock.days_to_unlock);
    if(days!==null && days>=0 && Number.isInteger(days)) readings.push(measured('days_to_unlock','距离解禁',number(days,'天'),
      '从本数据日到最近解禁日的自然日数。',days,'天'));
    const concentration=observedNumber(unlock.unlock_concentration);
    if(concentration!==null && concentration>=0 && concentration<=100)
      readings.push(measured('unlock_concentration','解禁集中度',number(concentration,'%'),
        '最大单一持有人解禁量占本次有效解禁量的比例。',concentration,'%'));
  }
  readings.push(...flags(risk.flags).map(v=>item('风险提示','需关注',v)));
  const byId=Object.fromEntries(readings.filter(r=>r.metric_id).map(r=>[r.metric_id,r]));
  const parts=[];
  if(byId.max_drawdown_20) {
    parts.push(`近20日最大回撤${byId.max_drawdown_20.value}${byId.max_drawdown_60?`，60日${byId.max_drawdown_60.value}`:''}。`);
  }
  if(byId.volatility_20) {
    const short=byId.volatility_20,long=byId.volatility_60;
    parts.push(long?`20日日涨跌波动${short.value}，${short.numeric_value>long.numeric_value?'高于':short.numeric_value<long.numeric_value?'低于':'等于'}60日的${long.value}。`
      :`20日日涨跌波动${short.value}。`);
  }
  if(byId.unlock_pressure_score) {
    const ratio=byId.unlock_float_share_ratio,days=byId.days_to_unlock;
    parts.push(`解禁压力${byId.unlock_pressure_score.value}${ratio?`，占流通股${ratio.value}`:''}${days?`，距解禁${days.value}`:''}。`);
  }
  const groups=[
    group('market','大盘风险',day,[item('画像周期',text(market.label)||'待更新','这是原股票画像保存的周期，不代替独立市场风险。')],
      {summary:'独立市场风险待核对。'}),
    group('industry','行业风险',day,[item('所属行业',text(industry)||'待更新','行业风险不等同个股价格风险。'),
      item('板块阶段',text(sector.label)||'待更新','用于判断行业机会处于启动、延续还是退潮阶段。'),
      ...flags(sector.risk_flags).map(v=>item('行业提示','需关注',v))],
      {level:level(sector.risk_level),summary:'结合板块阶段与已保存的行业风险提示观察；独立行业风险分待评估。'}),
    // Keep the v1 base measurement vocabulary for older clients. New measures
    // belong to the optional dimension extension consumed by the upgraded app.
    group('stock','标的风险',day,readings.filter(i=>i.metric_id!=='liquidity_amount_20'),{score:score(metrics.risk_score),
      score_kind:score(metrics.risk_score)===null?'none':'price_pressure',level:level(risk.level),
      summary:parts.join('') || (readings.length?'本日风险提示已更新，可展开查看具体事项。':'本数据日的价格风险细项待更新。')}),
  ];
  if(marketPortrait?.owner==='market' && marketPortrait.business_date===day && marketPortrait.display_only===true) {
    const marketGroup=marketPortrait.groups?.find(g=>g.scope==='market' && g.business_date===day);
    if(marketGroup) groups[0]=marketGroup;
    const industryGroups=(marketPortrait.groups||[]).filter(g=>g.scope==='industry'&&g.business_date===day);
    const exact=industryGroups.filter(g=>g.title===industry);
    if(exact.length===1) {
      const stage=groups[1].items.filter(i=>i.title==='板块阶段'||i.title==='行业提示');
      groups[1]={...exact[0],items:[...exact[0].items,...stage].slice(0,16)};
    } else {
      groups[1].items.push(item('分类关联','待核对','所属行业尚无唯一同日关联，保留缺失状态。'));
    }
  }
  const result=envelope(code,day,groups);
  result.dimensions=stockRiskDimensions({groups,industry,day,financial,code,stockItems:readings});
  result.trap_signals=mobileTrapSignals({snapshot:signalSnapshot,code,day});
  return result;
}

export function marketRiskPortrait({scoreRow={},observation={},sentimentRows=[],flowRows=[],
  industryRows=[],capitalValue=()=> '--',industryValue=()=> '--'}) {
  const day=businessDate(observation.business_date);
  if (!day) return envelope('market','',[]);
  const sentiment=sentimentRows.find(r=>businessDate(r.trade_date||r._data_date)===day)||{};
  const flow=publishedMarketFlow(flowRows,{day})||{};
  const up=observedNumber(sentiment.up_count),total=observedNumber(sentiment.total_count);
  const ready=observation.status==='ready';
  const rows=[item('市场阶段',text(scoreRow.market_phase)||'待更新','市场阶段反映整体环境，不替代个股风险。')];
  if (up!==null && total!==null && total>0 && up>=0 && up<=total)
    rows.push(measured('advancing_share','上涨家数占比',number(up/total*100,'%'),'占比越低，行情上涨的覆盖面越窄。',up/total*100,'%'));
  const down=observedNumber(sentiment.limit_down_count);
  if (down!==null && down>=0 && Number.isInteger(down))
    rows.push(measured('limit_down_count','跌停家数',number(sentiment.limit_down_count,'只'),'观察极端下跌是否扩散。',down,'只'));
  const flowValue=capitalValue(flow.main_net??flow.net_amount);
  if (businessDate(flow.trade_date||flow._data_date)===day && flowValue!=='--')
    rows.push(item('主力资金净额',flowValue,'净流出表示该日资金流出压力；并不单独决定后续方向。'));
  const market=group('market','大盘风险',day,rows,{score:ready?score(observation.value):null,
    score_kind:ready&&score(observation.value)!==null?'market_environment':'none',level:ready?level(scoreRow.risk_level):'待评估',
    summary:ready?'市场环境分越高，环境支持度越强；它不是风险分。':'市场评分待复核，暂不使用它给出风险分或风险等级。'});
  const industries=industryRows.slice(0,24).map((r)=>{
    const date=businessDate(r.trade_date||r._data_date);
    if (!date || date>day) return null;
    const name=text(r.industry_name||r.sector_name||r.name);
    if (!name) return null;
    const items=[];
    const sectorType=text(r.sector_type_label);
    if(sectorType) items.push(item('板块类型',sectorType,'供应商板块身份；板块不等于统一行业。'));
    const composition=Array.isArray(r.canonical_industry_top3)?r.canonical_industry_top3:[];
    if(r.mapping_semantics==='one_to_one' && text(r.dominant_canonical_industry_name)) {
      items.push(item('统一行业',text(r.dominant_canonical_industry_name),'已通过成员覆盖与主导行业纯度门槛。'));
    } else if(r.mapping_semantics==='one_to_many' && composition.length) {
      const value=composition.map(entry=>{
        const name=text(entry.canonical_industry_name)||'未命名行业';
        const weight=observedNumber(entry.member_weight);
        return weight===null?name:`${name} ${Number((weight*100).toFixed(1))}%`;
      }).join(' · ');
      items.push(item('Top3 行业构成',value,'跨行业板块保留一对多构成，不强行映射成单一行业。'));
    } else if(text(r.sector_classification_label)) {
      items.push(item('统一行业状态',text(r.sector_classification_label),'缺少唯一行业证据时不生成统一行业风险分。'));
    }
    const change=observedNumber(r.pct_change??r.change_pct??r.change_percent);
    if(change!==null) items.push(measured('industry_return','行业涨跌',number(change,'%'),'反映该日行业价格表现；不等同未来风险概率。',change,'%'));
    const net=industryValue(r);
    if(net!=='--') items.push(item('行业资金净额',net,'与涨跌对照观察承接或流出压力。'));
    const count=observedNumber(r.company_count);
    if(count!==null && Number.isInteger(count) && count>0)
      items.push(measured('industry_company_count','行业公司数',number(count,'家'),
        '供应商行业口径的公司数，不等于本系统同业有效样本数或风险覆盖率。',count,'家'));
    const leader=text(r.lead_stock),leaderChange=observedNumber(r.lead_stock_pct);
    if(leader) items.push(item('来源领涨股',leader,'供应商该行业同日的领涨观察，不代表全市场或未来领导力。'));
    if(leader && leaderChange!==null && leaderChange>=-100)
      items.push(measured('industry_leader_return','领涨股涨跌',number(leaderChange,'%'),
        '与行业涨跌对照观察分化；单只领涨股不能证明行业整体低风险。',leaderChange,'%'));
    // Only accept a producer-declared risk score, never hot_score/lifecycle score.
    const explicit=r.risk_score_kind==='risk_pressure_0_100_higher_is_worse';
    const crossIndustry=r.mapping_semantics==='one_to_many';
    return group('industry',name,date,items,{score:explicit?score(r.risk_score):null,
      score_kind:explicit&&score(r.risk_score)!==null?'risk_pressure':'none',
      level:explicit?level(r.risk_level):'待评估',
      summary:explicit?'行业风险分与价格、资金细项分开查看；涨跌幅和热度不替代风险分。'
        :crossIndustry?'该板块跨多个统一行业，展示成分构成但不伪造单一行业风险分。'
        :'当前已上传的是行业价格、资金及领涨观测，未包含独立风险等级和压力分；缺失不代表低风险。'});
  }).filter(Boolean);
  return envelope('market',day,[market,...industries]);
}
