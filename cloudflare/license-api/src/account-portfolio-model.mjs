/** Mobile account facts and user-target scenarios; no orders or desktop state. */
import {canonical, digest} from './minute-delivery.mjs';
import {buildAccountPortfolioRisk,PORTFOLIO_RISK_VERSION} from './account-portfolio-risk.mjs';

export const ENGINE='mobile-account-portfolio.v2';
export function requirePortfolio(ok, code, status=422) {
  if(!ok)throw Object.assign(new Error(code),{status,publicMessage:code});
}
const check=requirePortfolio;
const SCALE=1000000n;
const safe=n=>{check(n>=-9007199254740991n&&n<=9007199254740991n,'portfolio_amount_out_of_range');return Number(n);};
export function decimal(value, {nullable=false, signed=false, max=1000000000}={}) {
  if(value===null||value===undefined||value===''){check(nullable,'portfolio_number_required');return null;}
  const str=String(value).trim();
  check((signed?/^-?\d{1,12}(\.\d{1,6})?$/:/^\d{1,12}(\.\d{1,6})?$/).test(str),'portfolio_number_invalid');
  check(Number.isFinite(Number(str))&&Math.abs(Number(str))<=max,'portfolio_number_out_of_range');
  const negative=str.startsWith('-'),[whole,fraction='']=str.replace(/^-/,'').split('.');
  const scaled=(BigInt(whole)*SCALE+BigInt(fraction.padEnd(6,'0')))*(negative?-1n:1n);
  return {text:(negative&&scaled!==0n?'-':'')+String(BigInt(whole))+(fraction.replace(/0+$/,'')?'.'+fraction.replace(/0+$/,''):''),scaled};
}
const cents=(v,nullable=false)=>{
  const d=decimal(v,{nullable,signed:true,max:900000000000});if(d===null)return null;
  check(d.scaled%10000n===0n,'portfolio_money_requires_cents');return safe(d.scaled/10000n);
};
const amount=(q,p)=>safe((decimal(q).scaled*decimal(p,{max:1000000000}).scaled+5000000000n)/10000000000n);
const major=n=>n===null?null:n/100;
const ratio=(part,total)=>part!==null&&total!==null&&total>0?part/total:null;
const pct=(v)=>v===null?null:Math.round(v*10000)/100;
const dayOf=now=>new Date(new Date(now).getTime()+8*3600000).toISOString().slice(0,10);
function date(value,now,nullable=true){
  if(!value){check(nullable,'portfolio_snapshot_date_required');return null;}
  check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&
    new Date(value).toISOString().slice(0,10)===value&&value<=dayOf(now),'portfolio_date_invalid');return value;
}
export function instrument(type,code){
  check(['stock','fund','bond'].includes(type),'portfolio_asset_type_unsupported');
  const normalized=String(code||'').toUpperCase().replace(/^(SH|SZ|BJ)/,'').replace(/\.(SH|SZ|BJ)$/,'');
  check(/^\d{6}$/.test(normalized),'portfolio_instrument_invalid');
  return {asset_type:type,code:normalized,instrument_id:`CN:${type}:${normalized}`};
}
export function normalizePortfolioInput(raw,now=new Date(),{legacy=false}={}) {
  check(raw&&typeof raw==='object'&&!Array.isArray(raw),'portfolio_input_required');
  check(raw.currency===undefined||raw.currency==='CNY','portfolio_currency_unsupported');
  check(Array.isArray(raw.positions)&&raw.positions.length<=200,'portfolio_position_limit');
  const seen=new Set();
  const positions=raw.positions.map(p=>{
    const id=instrument(p.asset_type||'stock',p.code),q=decimal(p.quantity);
    check(q.scaled>0n,'portfolio_quantity_positive_required');
    if(id.asset_type!=='fund')check(q.scaled%SCALE===0n,'portfolio_integral_quantity_required');
    check(!seen.has(id.instrument_id),'portfolio_duplicate_instrument');seen.add(id.instrument_id);
    let cost=decimal(p.cost_price,{nullable:true});
    if(legacy&&(!cost||cost.scaled===0n))cost=null;
    const sellable=decimal(p.sellable_quantity,{nullable:true});
    check(sellable===null||(sellable.scaled>=0n&&sellable.scaled<=q.scaled),'portfolio_sellable_quantity_invalid');
    if(id.asset_type!=='fund'&&sellable!==null)check(sellable.scaled%SCALE===0n,'portfolio_integral_quantity_required');
    return {...id,name:String(p.name||id.code).slice(0,128),quantity:q.text,cost_price:cost?.text??null,
      sellable_quantity:legacy?null:sellable?.text??null};
  }).sort((a,b)=>a.instrument_id.localeCompare(b.instrument_id));
  const cash=cents(raw.cash_total,true),available=cents(raw.cash_available,true);
  check(cash===null||cash>=0,'portfolio_cash_negative');
  check(available===null||(cash!==null&&available>=0&&available<=cash),'portfolio_available_cash_invalid');
  const policy={};
  for(const key of ['min_cash_pct','invested_min_pct','invested_max_pct','single_max_pct','industry_max_pct']){
    const v=raw.policy?.[key];
    check(v===undefined||v===null||v===''||(/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(String(v))&&Number(v)>=0&&Number(v)<=100),'portfolio_target_invalid');
    policy[key]=v===undefined||v===null||v===''?null:Number(v);
  }
  check(policy.invested_min_pct===null||policy.invested_max_pct===null||policy.invested_min_pct<=policy.invested_max_pct,'portfolio_target_conflict');
  check(policy.invested_min_pct===null||policy.min_cash_pct===null||policy.invested_min_pct+policy.min_cash_pct<=100,'portfolio_target_conflict');
  check(legacy||!Object.values(policy).some(v=>v!==null)||raw.targets_confirmed===true,'portfolio_target_confirmation_required');
  const asOf=date(raw.holdings_as_of,now,legacy);
  return {currency:'CNY',positions,cash_total:major(cash),cash_available:major(available),holdings_as_of:asOf,
    cash_as_of:cash===null?null:date(raw.cash_as_of||raw.holdings_as_of,now,false),policy,
    targets_confirmed:Object.values(policy).some(v=>v!==null),input_source:legacy?'legacy_mobile_manual':'mobile_manual'};
}
function priceFact(position, fact, now) {
  if(!fact||fact.instrument_id!==position.instrument_id||fact.currency!=='CNY'||fact.price_basis!=='unadjusted')return null;
  const price=decimal(fact.price,{nullable:true});if(!price||price.scaled<=0n)return null;
  const d=date(fact.price_as_of,now,true);if(!d||!fact.available_at||!fact.source_ref)return null;
  const known=Date.parse(fact.available_at);if(!Number.isFinite(known)||known>new Date(now).getTime())return null;
  // Explicit stale state is conservative; no cost/manual fallback is accepted.
  const elapsed=(Date.parse(dayOf(now))-Date.parse(d))/86400000;
  if(fact.quality!=='complete'||(fact.current_session_date?d!==fact.current_session_date:elapsed>7))return null;
  return {...fact,price:price.text,price_as_of:d};
}
function weightedGroups(items,key,total) {
  const groups=new Map();let unknown=0;
  for(const p of items){const value=p.market_value_cents;if(value===null)continue;
    const label=p[key];if(!label){unknown+=value;continue;}groups.set(label,(groups.get(label)||0)+value);}
  return {groups:[...groups].map(([name,value])=>({name,amount:major(value),weight_pct:pct(ratio(value,total))})).sort((a,b)=>b.amount-a.amount),
    unknown_amount:major(unknown),coverage_complete:unknown===0&&items.every(p=>p.market_value_cents!==null)};
}
function metrics(items,cash) {
  const priced=items.filter(p=>p.market_value_cents!==null),complete=priced.length===items.length;
  const knownValue=priced.reduce((n,p)=>n+p.market_value_cents,0);check(Number.isSafeInteger(knownValue),'portfolio_amount_out_of_range');
  const total=complete&&cash!==null?knownValue+cash:null;check(total===null||Number.isSafeInteger(total),'portfolio_amount_out_of_range');
  const costComplete=items.every(p=>p.cost_total_cents!==null);
  const cost=costComplete?items.reduce((n,p)=>n+p.cost_total_cents,0):null;
  check(cost===null||Number.isSafeInteger(cost),'portfolio_amount_out_of_range');
  const pnl=complete&&cost!==null?knownValue-cost:null;
  check(pnl===null||Number.isSafeInteger(pnl),'portfolio_amount_out_of_range');
  return {pricing_complete:complete,priced_count:priced.length,position_count:items.length,
    known_market_value:major(knownValue),market_value:complete?major(knownValue):null,total_assets:major(total),
    cash_total:major(cash),total_cost:major(cost),unrealized_pnl:major(pnl),unrealized_pnl_pct:pct(ratio(pnl,cost)),
    invested_pct:pct(ratio(knownValue,total)),cash_pct:pct(ratio(cash,total)),_total:total,_invested:knownValue};
}
function guidance(items,valuation,policy,exposure) {
  const result=[],N=valuation._total;
  const add=(id,title,detail,extra={})=>result.push({id,title,detail,state:'informational',...extra});
  if(!valuation.pricing_complete)add('price-gap','先补齐估值依据',`${items.length-valuation.priced_count}项持仓缺少合格价格，完整仓位和金额方案暂不可计算。`,{state:'data_pending'});
  if(valuation.cash_total===null)add('cash-gap','确认现金余额','现金未知时，不把证券持仓内部占比解释为账户实际仓位。',{state:'data_pending'});
  if(N>0){
    for(const p of items){
      const weight=p.market_value_cents/N*100;
      if(policy.single_max_pct!==null&&weight>policy.single_max_pct){
        const targetCents=safe(BigInt(N)*decimal(policy.single_max_pct).scaled/(100n*SCALE));
        const delta=Math.max(0,p.market_value_cents-targetCents);
        add('single:'+p.instrument_id,`${p.name}超出单项目标`, `当前占账户${weight.toFixed(1)}%，高于你设定的${policy.single_max_pct}%。可先比较降低集中度的方案。`,
          {state:'sizing_available',instrument_id:p.instrument_id,current_pct:weight,target_pct:policy.single_max_pct,reference_delta_amount:major(-delta),
            conditions:['金额为按用户目标的情景测算；可卖数量、价格变化及费用仍需核对。']});
      }
    }
    if(policy.min_cash_pct!==null&&valuation.cash_pct<policy.min_cash_pct)add('cash-below','现金低于自己的目标',`当前现金${valuation.cash_pct.toFixed(1)}%，目标至少${policy.min_cash_pct}%。优先比较保留现金或降低集中度的方案。`,{state:'conditional'});
    if(policy.invested_max_pct!==null&&valuation.invested_pct>policy.invested_max_pct)add('invested-high','总仓位高于目标上沿',`当前${valuation.invested_pct.toFixed(1)}%，你设置的上沿为${policy.invested_max_pct}%。`,{state:'conditional'});
    if(policy.invested_min_pct!==null&&valuation.invested_pct<policy.invested_min_pct)add('invested-low','总仓位低于自己的目标',`当前${valuation.invested_pct.toFixed(1)}%，低于目标下沿${policy.invested_min_pct}%。这只是目标偏离，不代表必须买入。`,{state:'conditional'});
    if(policy.industry_max_pct!==null)for(const g of exposure.industry.groups)if(g.weight_pct>policy.industry_max_pct)
      add('industry:'+g.name,`${g.name}集中度偏高`,`已识别直接股票占账户${g.weight_pct.toFixed(1)}%，高于你的行业上限${policy.industry_max_pct}%。基金等未穿透部分另列。`,{state:'conditional'});
  }
  if(!Object.values(policy).some(v=>v!==null))add('targets','设置自己的仓位目标','先确认现金下限、总仓位范围或单项上限，再查看对应金额预演。',{state:'data_pending'});
  if(!result.length)add('within','当前配置在已设目标范围内','这是已设目标和已核验数据的比较，不代表未来收益或所有风险均已评估。');
  return result;
}
export async function analyzeAccountPortfolio(state,facts,now=new Date()) {
  const input=state.input,byId=new Map(facts.map(f=>[f.instrument_id,f]));
  const items=input.positions.map(p=>{
    let f=null;try{f=priceFact(p,byId.get(p.instrument_id),now);}catch{}
    const value=f?amount(p.quantity,f.price):null,cost=p.cost_price===null?null:amount(p.quantity,p.cost_price);
    const pnl=value!==null&&cost!==null?value-cost:null;
    return {...p,name:f?.name||p.name,current_price:f?Number(f.price):null,price_as_of:f?.price_as_of??null,price_status:f?'priced':'unavailable',
      source_ref:f?.source_ref??null,market_value_cents:value,cost_total_cents:cost,
      market_value:major(value),cost_total:major(cost),unrealized_pnl:major(pnl),unrealized_pnl_pct:pct(ratio(pnl,cost)),
      industry:p.asset_type==='stock'?f?.industry??null:null,board:p.asset_type==='stock'?f?.board??null:null,
      assessment:{state:f?'basic_observation':'data_pending',title:f?'持仓事实已更新':'估值依据待补',
        detail:f?'仓位与浮盈按本次持仓及已发布价格计算，深度评分需另行取得同版本研究证据。':'未使用成本替代当前价格，相关数值保持未知。'}};
  });
  const v=metrics(items,cents(input.cash_total,true));
  for(const p of items){
    const w=pct(ratio(p.market_value_cents,v._total));
    if(p.price_status!=='priced')continue;
    const above=w!==null&&input.policy.single_max_pct!==null&&w>input.policy.single_max_pct;
    p.assessment={state:above?'target_deviation':'basic_observation',
      title:above?'集中度超出我的目标':p.cost_price===null?'估值可用，成本待确认':'持仓事实可核对',
      detail:[`已发布${p.price_as_of}价格；${w===null?'账户权重待补现金及其他价格':`占账户${w.toFixed(1)}%`}`,
        above?`高于自定单项上限${input.policy.single_max_pct}%`:null,
        p.cost_price===null?'未知成本未计算浮盈亏':`持仓浮盈亏${major(p.market_value_cents-p.cost_total_cents).toFixed(2)}元，不含已实现收益`,
        p.sellable_quantity===null?'可卖数量待确认':`填报可卖${p.sellable_quantity}，并非券商确认`,
      ].filter(Boolean).join('；')+'。'};
  }
  const exposure={asset_type:weightedGroups(items,'asset_type',v._total),industry:weightedGroups(items,'industry',v._total),board:weightedGroups(items,'board',v._total)};
  if(input.cash_total!==null)exposure.asset_type.groups.push({name:'cash',amount:input.cash_total,weight_pct:v.cash_pct});
  else exposure.asset_type.coverage_complete=false;
  const suggestions=guidance(items,v,input.policy,exposure);
  const key='sha256:'+await digest(canonical({engine:ENGINE,risk_engine:PORTFOLIO_RISK_VERSION,input_hash:state.input_hash,
    facts:items.map(p=>[p.instrument_id,p.name,p.current_price,p.price_as_of,p.source_ref,p.industry,p.board])}));
  const risk=buildAccountPortfolioRisk(items,v,input,exposure,state.revision);
  const status=!items.length&&input.cash_total===null?'empty':v._total===null?'partial':'available';
  return {schema_version:ENGINE,portfolio_id:state.portfolio_id,revision:state.revision,input_hash:state.input_hash,
    legacy_hash:state.legacy_hash??null,recorded_at:state.recorded_at??null,input,analysis_key:key,generated_at:new Date(now).toISOString(),
    status,valuation:Object.fromEntries(Object.entries(v).filter(([k])=>!k.startsWith('_'))),
    positions:items.map(p=>({...Object.fromEntries(Object.entries(p).filter(([k])=>!k.endsWith('_cents'))),weight_pct:pct(ratio(p.market_value_cents,v._total))})),
    exposure,guidance:suggestions,risk,warnings:state.warnings||[],orders_authorized:false,
    boundary:'按移动账户快照与用户目标测算；未连接券商，不含完整成交业绩，不自动调整持仓。'};
}
export async function previewAccountScenario(analysis,request) {
  check(request.analysis_key===analysis.analysis_key,'portfolio_analysis_changed',409);
  check(analysis.valuation.total_assets!==null&&analysis.valuation.total_assets>0,'portfolio_complete_valuation_required');
  check(Array.isArray(request.adjustments)&&request.adjustments.length>0&&request.adjustments.length<=200,'portfolio_adjustments_required');
  const seen=new Set(),items=analysis.positions.map(p=>({...p,market_value_cents:cents(p.market_value),cost_total_cents:p.cost_total===null?null:cents(p.cost_total)}));
  const cashBefore=cents(analysis.input.cash_total),available=cents(analysis.input.cash_available,true);
  let cash=cashBefore,availableAfter=available;const conditions=[];
  const deltas=request.adjustments.map(a=>{
    check(!seen.has(a.instrument_id),'portfolio_duplicate_adjustment');seen.add(a.instrument_id);
    const p=items.find(p=>p.instrument_id===a.instrument_id);check(p,'portfolio_adjustment_outside_account');
    const delta=cents(a.delta_amount);check(delta!==0,'portfolio_adjustment_zero');
    check(p.market_value_cents+delta>=0,'portfolio_adjustment_exceeds_position');
    if(delta<0){
      if(p.sellable_quantity===null)conditions.push(`${p.name}可卖数量尚未核实。`);
      else if(-delta>amount(p.sellable_quantity,String(p.current_price)))conditions.push(`${p.name}测算金额超过当前填报可卖数量。`);
    }
    p.market_value_cents+=delta;cash-=delta;
    if(availableAfter!==null)availableAfter-=delta;
    check(Number.isSafeInteger(p.market_value_cents)&&Number.isSafeInteger(cash)&&
      (availableAfter===null||Number.isSafeInteger(availableAfter)),'portfolio_amount_out_of_range');
    return {instrument_id:p.instrument_id,name:p.name,delta_amount:major(delta)};
  });
  const fees=cents(request.estimated_fees,true);check(fees===null||fees>=0,'portfolio_fees_invalid');
  if(fees===null)conditions.push('费用尚未提供，以下对照未计费用。');
  cash-=fees??0;if(availableAfter!==null)availableAfter-=fees??0;
  check(cash>=0,'portfolio_scenario_cash_insufficient');
  if(deltas.some(a=>a.delta_amount>0)){
    check(available!==null,'portfolio_available_cash_required');
    check(availableAfter>=0,'portfolio_scenario_available_cash_insufficient');
    if(deltas.some(a=>a.delta_amount<0))conditions.push('增加配置依赖测算中的减持资金，不表示该资金已可用。');
  }
  const after=metrics(items,cash),policy=analysis.input.policy;
  if(policy.min_cash_pct!==null&&after.cash_pct<policy.min_cash_pct)conditions.push('调整后现金低于你设定的下限。');
  if(policy.invested_max_pct!==null&&after.invested_pct>policy.invested_max_pct)conditions.push('调整后总仓位仍高于目标上沿。');
  if(policy.invested_min_pct!==null&&after.invested_pct<policy.invested_min_pct)conditions.push('调整后总仓位低于目标下沿。');
  const result={analysis_key:analysis.analysis_key,input_revision:analysis.revision,adjustments:deltas,estimated_fees:major(fees),
    before:analysis.valuation,after:Object.fromEntries(Object.entries(after).filter(([k])=>!k.startsWith('_')&&!k.includes('pnl')&&k!=='total_cost')),
    positions:items.map(p=>({instrument_id:p.instrument_id,name:p.name,market_value:major(p.market_value_cents),weight_pct:pct(ratio(p.market_value_cents,after._total))})),
    conditions,state:conditions.length?'conditional':'reference',orders_authorized:false,execution_authorized:false};
  result.scenario_hash='sha256:'+await digest(canonical(result));return result;
}
