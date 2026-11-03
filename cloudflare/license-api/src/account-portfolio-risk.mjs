/** Snapshot risk facts, self-defined policy deviations and deterministic shocks.
 * No composite score, probability, correlation estimate or execution authority.
 */
export const PORTFOLIO_RISK_VERSION='mobile-portfolio-risk.v1';
const percent=(n,d)=>n!==null&&d!==null&&d>0?Math.round(n/d*10000)/100:null;
const amount=n=>n===null?null:n/100;
const safeSum=values=>{const n=values.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(n))throw new Error('portfolio_amount_out_of_range');return n;};
const textPct=n=>n===null?'待核验':`${n.toFixed(1)}%`;

export function buildAccountPortfolioRisk(items,valuation,input,exposure,revision) {
  const total=valuation._total,known=valuation._invested;
  const usable=total!==null&&total>0;
  const valued=items.filter(p=>p.market_value_cents!==null);
  const ranked=[...valued].sort((a,b)=>b.market_value_cents-a.market_value_cents||a.instrument_id.localeCompare(b.instrument_id));
  const largest=ranked[0]||null,largestPct=largest&&usable?percent(largest.market_value_cents,total):items.length===0&&usable?0:null;
  const top3=usable?percent(safeSum(ranked.slice(0,3).map(p=>p.market_value_cents)),total):null;
  const coreComplete=valuation.pricing_complete&&total!==null&&Boolean(input.holdings_as_of);
  const dimensions=[];
  const add=(id,title,state,value,detail,extras={})=>dimensions.push({id,title,state,value,detail,
    basis:'账户快照与已发布价格',...extras});
  const cap=input.policy.single_max_pct;
  const breaches=usable&&cap!==null?ranked.filter(p=>p.market_value_cents/total*100>cap):[];
  add('concentration','持仓集中度',!usable?'data_pending':breaches.length?'target_deviation':cap===null?'observation':'within_target',
    largestPct===null?'待核验':`最大单项 ${textPct(largestPct)}`,
    !usable?'完整账户资产未取得，不能把证券内部占比当作账户权重。':
      `${largest?largest.name+'占账户'+textPct(largestPct):'当前没有证券持仓'}；前三项合计${textPct(top3)}。`+
      (cap===null?'尚未设置单项上限，未据此判定高低风险。':`你的单项上限为${cap}%，${breaches.length}项超出目标。`),
    {current_pct:largestPct,target_pct:cap,affected_instruments:breaches.map(p=>p.instrument_id),focus_instrument_id:breaches[0]?.instrument_id??null,
      evidence:ranked.slice(0,3).map(p=>`${p.name}：${textPct(percent(p.market_value_cents,total))}`),top3_pct:top3});

  for(const [key,title,target] of [['industry','行业暴露',input.policy.industry_max_pct],['board','板块暴露',null]]){
    const group=exposure[key],stockItems=items.filter(p=>p.asset_type==='stock');
    const missing=stockItems.filter(p=>!p[key]||p.market_value_cents===null);
    const notThrough=items.filter(p=>p.asset_type!=='stock');
    const max=group.groups[0]||null;
    const exceed=usable&&target!==null?group.groups.filter(g=>g.weight_pct>target):[];
    const full=usable&&missing.length===0&&notThrough.length===0;
    const groupDetails=group.groups.map(g=>`${g.name} ${textPct(g.weight_pct)}`).join('、');
    add(key,title,exceed.length?'target_deviation':!full?'partial':target===null?'observation':'within_target',
      max?`${max.name} ${textPct(max.weight_pct)}`:stockItems.length?'分类待补':'无直接股票',
      `${groupDetails||'当前没有可用的直接股票分组。'}${missing.length?`；${missing.length}项股票分类或价格待补`:''}`+
      (notThrough.length?`；${notThrough.length}项基金/债券未穿透，不代表完整底层暴露。`:'。')+
      (target===null?'':' 仅将已识别行业与用户自定上限比较；未识别部分不作为零暴露。'),
      {target_pct:target,coverage_complete:full,unclassified_count:missing.length,not_looked_through_count:notThrough.length,
        affected_instruments:[],evidence:group.groups.map(g=>`${g.name}：${textPct(g.weight_pct)}（占账户）`),
        basis:'直接股票公开分类；基金及债券未穿透'});
  }
  const min=input.policy.min_cash_pct;
  const low=input.policy.invested_min_pct,high=input.policy.invested_max_pct;
  const allocationOutside=usable&&((low!==null&&valuation.invested_pct<low)||(high!==null&&valuation.invested_pct>high));
  add('allocation','总仓位与目标',!usable?'data_pending':allocationOutside?'target_deviation':low===null&&high===null?'observation':'within_target',
    `总仓位 ${textPct(valuation.invested_pct)}`,
    `个人目标下沿${low===null?'未设置':low+'%'}，上沿${high===null?'未设置':high+'%'}。低于目标不表示应立即买入；该比较不替代风险判断。`);
  const cashLow=usable&&min!==null&&valuation.cash_pct<min;
  add('cash','现金缓冲',!usable?'data_pending':cashLow?'target_deviation':min===null?'observation':'within_target',
    `现金 ${textPct(valuation.cash_pct)}`,
    input.cash_total===null?'现金余额未知，总仓位和现金占比暂不计算。':
      `已提供现金余额，占账户${textPct(valuation.cash_pct)}。`+(min===null?'尚未设置现金下限，不以统一比例判断充足与否。':`你的最低现金目标为${min}%。`)+
      (input.cash_available===null?'可用现金尚未确认。':'可用现金已填报，仍需在操作前核对。'),
    {current_pct:valuation.cash_pct,target_pct:min,evidence:[`现金确认日：${input.cash_as_of||'未确认'}`]});

  const sellableKnown=items.filter(p=>p.sellable_quantity!==null).length;
  const restricted=items.filter(p=>p.sellable_quantity!==null&&Number(p.sellable_quantity)<Number(p.quantity));
  add('liquidity','资金与可卖约束',input.cash_available===null||sellableKnown<items.length?'partial':restricted.length?'conditional':'observation',
    `可卖资料 ${sellableKnown}/${items.length}项`,
    `${restricted.length}项填报可卖量少于持有量；可卖量与可用资金均为用户快照，尚非券商确认。未使用股票数量或市值冒充成交流动性。`,
    {affected_instruments:restricted.map(p=>p.instrument_id),evidence:[input.cash_available===null?'可用现金：未知':'可用现金：已填报，非券商确认'],
      basis:'用户填报数量与可用资金；不含成交量、价差或市场深度'});

  const missingCost=items.filter(p=>p.cost_price===null).length;
  add('evidence','资料完整性',coreComplete?'observation':'data_pending',
    `合格价格 ${valuation.priced_count}/${items.length}项`,
    `${input.holdings_as_of?'持仓确认日 '+input.holdings_as_of:'持仓时间待确认'}；${missingCost}项成本未知。未知成本影响浮盈亏，不自动阻断结构分析。`,
    {evidence:items.filter(p=>p.market_value_cents===null).map(p=>`${p.name}：缺少合格价格`),
      basis:`账户快照版本${revision}；按各持仓价格日计算，不冒充同一交易时刻`});

  add('research','历史与研究风险','not_assessed','待接适用证据',
    '当前尚未聚合适用日期的个股研究风险，也未计算组合相关性、波动率、最大回撤或基金底层重叠。请在标的研究中逐项核对；未知不解释为低风险。',
    {basis:'需要同版本研究证据、对齐价格序列及持有记录'});

  const shocks=usable&&valuation.pricing_complete?[-5,-10].map(shock=>{
    // Canonical integer-cent holdings, rounded once for the portfolio total.
    const change=known===0?0:-Number((BigInt(known)*BigInt(-shock)+50n)/100n);
    const after=total+change;
    return {shock_pct:shock,estimated_change_amount:amount(change),assets_after:amount(after),account_change_pct:percent(change,total),
      cash_after:input.cash_total,basis:'全部证券市值同步变动，现金不变；未计费用和税费',
      boundary:'这是给定假设的金额敏感度，不是回撤预测、发生概率或真实账户历史业绩。'};
  }):[];
  const targetIssues=dimensions.filter(d=>d.state==='target_deviation');
  const pendingCore=!coreComplete;
  const primary=pendingCore?dimensions.find(d=>d.id==='evidence'):targetIssues[0]||dimensions.find(d=>d.state==='partial')||dimensions[0];
  const headline=pendingCore?'先补齐账户与估值依据':targetIssues.length?'主要关注：'+(primary.id==='concentration'?'单项配置偏高':primary.id==='cash'?'现金低于个人目标':primary.id==='allocation'?'总仓位偏离个人目标':'行业配置偏高'):
    items.length===0?'现金组合，当前无证券持仓':'已形成结构分析，仍需核对研究风险';
  return {version:PORTFOLIO_RISK_VERSION,state:pendingCore?'partial':targetIssues.length?'attention':'observed',
    label:pendingCore?'资料待补':targetIssues.length?'配置有偏离':'结构分析',headline,
    detail:primary.detail,score:null,largest_position_pct:largestPct,top3_pct:top3,target_issue_count:targetIssues.length,
    primary_dimension:primary.id,focus_instrument_id:primary.focus_instrument_id??null,
    dimensions,shocks,coverage:{priced_count:valuation.priced_count,position_count:items.length,
      core_complete:coreComplete,lookthrough_complete:items.every(p=>p.asset_type==='stock'),research_complete:false},
    boundary:'个人目标偏离、观测事实、资料不足分别呈现；未生成综合风险等级或交易授权。'};
}
