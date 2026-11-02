// Read-only display of existing measurements; no synthetic comprehensive score.
import {TRAP_CATALOG} from './mobile-trap-catalog.mjs';
import {businessDate,observedNumber} from './market-display-contract.mjs';
import {financialDisplayInputs} from './stock-detail-visuals.mjs';

const hash = v => /^sha256:[a-f0-9]{64}$/.test(v || '');
const stamp = v => typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const dimension = (id,title,items,required,summary,score=null,scoreKind='none') => ({
  id,title,items,summary,score,score_kind:scoreKind,
  assessment_status:required.every(key=>items.some(i=>i.metric_id===key))?'observed':items.length?'partial':'missing',
  missing_dimensions:required.filter(key=>!items.some(i=>i.metric_id===key)),
});

export function stockRiskDimensions({groups=[],industry='',day,financial={},code,stockItems=null}) {
  const stock=groups.find(g=>g.scope==='stock')||{}, own=groups.find(g=>g.scope==='industry');
  const items=stockItems||stock.items||[], pick=ids=>items.filter(i=>ids.includes(i.metric_id));
  const report=businessDate(financial.report_date),ann=businessDate(financial.report_publish_date||financial.ann_date),
    available=businessDate(financial.data_available_date);
  const f=financial.code===code && report && report<=day && ann && ann<=day && available && available<=day
    ?financialDisplayInputs(financial,code,day):{};
  const financialItems=[['debt_to_assets','资产负债率','%'],['current_ratio','流动比率','倍'],
    ['quick_ratio','速动比率','倍'],['operating_cashflow_per_share','每股经营现金流','元']].flatMap(([id,title,unit])=>{
      const n=observedNumber(f[id]);
      return n===null || id!=='operating_cashflow_per_share'&&n<0?[]:[{metric_id:`financial_${id}`,title,
        value:`${Number(n.toFixed(2))}${unit}`,numeric_value:n,unit,
        reading:`报告期 ${report}，披露日 ${ann}。这是报表原值，不是风险评分或偿债能力认证。`}];
    });
  return [
    dimension('price','价格与回撤',pick(['max_drawdown_20','max_drawdown_60']),['max_drawdown_20','max_drawdown_60'],
      '价格压力分只描述价格路径，不能替代完整风险评级。',stock.score??null,stock.score_kind||'none'),
    dimension('volatility','波动与尾部',pick(['volatility_20','volatility_60','extreme_down_days_20']),
      ['volatility_20','volatility_60','extreme_down_days_20'],'对照短长周期波动与大跌天数，保留各自统计口径。'),
    dimension('liquidity','交易流动性',pick(['avg_turnover_20','liquidity_amount_20']),['avg_turnover_20','liquidity_amount_20'],
      '历史换手仅反映活跃度；成交额须有明确元口径才展示。有效样本覆盖、盘口深度与卖出冲击仍需核验。'),
    dimension('supply','解禁与供给',items.filter(i=>i.title==='最近解禁日'||['effective_unlock_shares','unlock_market_value',
      'unlock_float_share_ratio','unlock_pressure_score','days_to_unlock','unlock_concentration'].includes(i.metric_id)),
      ['effective_unlock_shares','unlock_float_share_ratio','unlock_pressure_score'],
      '仅使用已披露的解禁事件；缺少事件证据时不能按零解禁处理。',
      pick(['unlock_pressure_score'])[0]?.numeric_value??null,
      pick(['unlock_pressure_score']).length?'unlock_pressure':'none'),
    {id:'industry',title:'所属行业与板块',industry_name:industry,assessment_status:own?.score!==null&&own?.score!==undefined?'observed':own?.items?.length?'partial':'missing',
      score:own?.score??null,score_kind:own?.score_kind||'none',items:own?.items||[],
      summary:industry?`${industry} · 仅展示已关联的本行业事实；概念板块归属待单独验证。`:'所属行业待核对。',
      missing_dimensions:own?.missing_dimensions||['所属行业风险']},
    {id:'events',title:'财务与事件',assessment_status:financialItems.length||items.some(i=>i.title==='风险提示')?'partial':'missing',score:null,score_kind:'none',
      items:[...financialItems,...items.filter(i=>i.title==='风险提示')].slice(0,16),summary:'已披露报表读数与已保存风险提示分开保留；完整财务、治理及公告风险仍需独立评估。',
      missing_dimensions:['独立财务风险评估','公告与治理事件覆盖']},
  ].map(d=>({...d,business_date:day}));
}

export function mobileTrapSignals({snapshot,code,day,now=Date.now()}) {
  const valid=snapshot?.version==='mobile-stock-signals.v1' && snapshot.code===code && snapshot.business_date===day &&
    snapshot.display_only===true && snapshot.orders_authorized===false && snapshot.production_release_authorized===false &&
    hash(snapshot.source_hash) && hash(snapshot.input_revision_hash) && hash(snapshot.policy_hash) &&
    stamp(snapshot.known_at) && Date.parse(snapshot.known_at)<=now && Date.parse(snapshot.known_at)>=Date.parse(`${day}T15:00:00+08:00`) &&
    /^SCB-[a-f0-9]{32}$/.test(snapshot.batch_id||'') &&
    Array.isArray(snapshot.rules) && snapshot.rules.length===TRAP_CATALOG.length &&
    snapshot.rules.every(r=>r && typeof r==='object' && TRAP_CATALOG.some(c=>c.id===r.rule_id)) &&
    new Set(snapshot.rules.map(r=>r.rule_id)).size===TRAP_CATALOG.length;
  const rows=new Map(valid?snapshot.rules.map(r=>[r.rule_id,r]):[]);
  return TRAP_CATALOG.map(rule=>{
    const r=rows.get(rule.id), complete=r?.data_status==='complete' && r?.implementation==='implemented' &&
      ['unvalidated_research','shadow_fixture'].includes(r.calibration_status);
    const state=complete && ['triggered','not_triggered'].includes(r.assessment)?r.assessment:'not_assessed';
    return {id:rule.id,title:rule.title,business_date:day,state,
      implementation:r?.implementation==='implemented'?'implemented':rule.implemented?'implemented':'deferred',
      data_status:complete?'complete':'missing',calibration_status:complete?r.calibration_status:'unvalidated_research',
      summary:state==='triggered'?'已触发研究代理，需要结合后续承接复核；不证明诱导交易或操纵。':
        state==='not_triggered'?'对应事实完整，本次未触发该研究规则；不代表整体安全。':
        rule.implemented?'本标的、本数据日尚无完整已发布结果。':'需要逐笔、委托或账户事实，现有分钟线无法判断。',
      source_hash:valid?snapshot.source_hash:'',batch_id:valid?snapshot.batch_id:'',known_at:valid?snapshot.known_at:''};
  });
}
