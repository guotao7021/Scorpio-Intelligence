// Display-only projection. No score, trading gate, factor weight or forecast changes.
import {businessDate,observedNumber} from './market-display-contract.mjs';
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const first=(...v)=>v.map(observedNumber).find(n=>n!==null)??null;
const label=v=>typeof v==='string'&&v.trim()&&v.length<=80&&!/[_=]|\b(?:unknown|neutral|traceback|exception|sql)\b/i.test(v)&&!['未知','待确认','观察中'].includes(v.trim())?v.trim():'-';
const rawObj=v=>{try{return obj(typeof v==='string'?JSON.parse(v):v);}catch{return {};}};
const ratio=(a,b,percent=false)=>{a=observedNumber(a);b=observedNumber(b);return a===null||b===null||b===0?null:a/b*(percent?100:1);};
const rowDay=r=>businessDate(r?.report_date);
const stockCode=value=>String(value??'').trim().match(/\d{6}/)?.[0]||'';
const announcedBy=(r,day)=>{const raw=rawObj(r?.raw_payload),ann=businessDate(
  r?.report_publish_date||r?.ann_date||r?.announcement_date||raw.ann_date||raw.announcement_date);
  return !ann||ann<=day;
};
const exactRaw=(input,code,day)=>{
  const raw=rawObj(input.raw_payload),period=businessDate(input.report_date),ann=businessDate(input.report_publish_date),available=businessDate(input.data_available_date);
  return input.data_source==='tushare_fina_indicator' && raw.ts_code?.split('.')[0]===code && period &&
    businessDate(raw.end_date)===period && ann && businessDate(raw.ann_date)===ann && available && available<=day;
};

export function financialDisplayInputs(input,code,day) {
  input=obj(input);day=businessDate(day);
  if(input.code && input.code!==code) return {};
  const period=businessDate(input.report_date),ann=businessDate(input.report_publish_date||input.ann_date),available=businessDate(input.data_available_date);
  if(!day || period&&period>day || ann&&ann>day || available&&available>day) return {};
  const raw=rawObj(input.raw_payload);
  const exact=exactRaw(input,code,day);
  const extra=exact?raw:{};
  return {...input,
    grossprofit_margin:first(input.grossprofit_margin,extra.grossprofit_margin),netprofit_margin:first(input.netprofit_margin,extra.netprofit_margin),
    debt_to_assets:first(input.debt_to_assets,extra.debt_to_assets),current_ratio:first(input.current_ratio,extra.current_ratio),
    quick_ratio:first(input.quick_ratio,extra.quick_ratio),operating_cashflow_per_share:first(input.operating_cashflow_per_share,extra.ocfps)};
}

export function financialStatementInputs(statementRows,code,day,preferredPeriod='') {
  statementRows=obj(statementRows);day=businessDate(day);preferredPeriod=businessDate(preferredPeriod);
  if(!day||!/^[0-9]{6}$/.test(code)) return {};
  const clean=key=>(Array.isArray(statementRows[key])?statementRows[key]:[]).filter(r=>
    stockCode(r.code||r.ts_code)===code&&rowDay(r)&&rowDay(r)<=day&&announcedBy(r,day));
  const income=clean('income'),cashflow=clean('cashflow'),balance=clean('balance');
  const periods=[...new Set([...income,...cashflow,...balance].map(rowDay))].sort().reverse();
  if(!periods.length) return {};
  const shared=[...new Set(income.map(rowDay).filter(p=>cashflow.some(r=>rowDay(r)===p)))].sort().reverse();
  const period=periods.includes(preferredPeriod)?preferredPeriod:(shared[0]||periods[0]);
  const i=income.find(r=>rowDay(r)===period)||{},c=cashflow.find(r=>rowDay(r)===period)||{},b=balance.find(r=>rowDay(r)===period)||{};
  const revenue=first(i.total_revenue,i.revenue),cost=observedNumber(i.operating_cost),operatingProfit=observedNumber(i.operating_profit);
  const netProfit=first(i.parent_net_profit,i.net_profit),operatingCashflow=observedNumber(c.operating_cashflow);
  const currentAssets=observedNumber(b.current_assets_total),currentLiabilities=observedNumber(b.current_liabilities_total),inventory=observedNumber(b.inventory);
  const coverage=[['income',i],['cashflow',c],['balance',b]].filter(([,r])=>Object.keys(r).length).map(([k])=>k);
  const values={statement_report_date:period,statement_coverage:coverage,revenue,net_profit:netProfit,
    gross_margin:revenue!==null&&cost!==null?ratio(revenue-cost,revenue,true):null,
    operating_margin:ratio(operatingProfit,revenue,true),net_margin:ratio(netProfit,revenue,true),
    operating_cashflow:operatingCashflow,cash_conversion:ratio(operatingCashflow,netProfit,true),
    net_cash_increase:observedNumber(c.net_cash_increase),debt_to_assets:ratio(b.total_liabilities,b.total_assets,true),
    current_ratio:ratio(currentAssets,currentLiabilities),
    quick_ratio:currentAssets!==null&&inventory!==null?ratio(currentAssets-inventory,currentLiabilities):null,
    cash_to_current_liabilities:ratio(b.monetary_funds,currentLiabilities)};
  const cashConversion=values.cash_conversion,currentRatio=values.current_ratio,debt=values.debt_to_assets;
  values.financial_confidence=coverage.length===3?'高':coverage.length>=2?'中':'低';
  values.financial_conclusion=operatingCashflow!==null&&operatingCashflow<0?'经营现金流为负，利润现金支撑偏弱':
    cashConversion!==null&&cashConversion>=100?'经营现金流覆盖当期利润，利润含金量较强':
    cashConversion!==null&&cashConversion<60?'经营现金流对利润覆盖不足，现金质量承压':
    netProfit!==null&&netProfit>0&&operatingCashflow!==null?'盈利与经营现金流均为正，现金质量稳定':
    currentRatio!==null&&currentRatio<1?'流动资产不足以覆盖流动负债，短期偿债承压':
    debt!==null&&debt>=70?'资产负债率偏高，偿债安全边际较低':'当前报表未触发明显现金流或偿债压力信号';
  return values;
}

export function stockDetailVisuals({code,day,scoreRow={},details={},financial={},fundamental={},capital={},sector={},model={},quote={},board={}}) {
  day=businessDate(day);
  if(!day || !/^\d{6}$/.test(code)) return null;
  const identity=(!scoreRow.code||scoreRow.code===code)&&(!details.code||details.code===code);
  const scores=obj(details.scores);
  const dimensions=[['technical','技术',scoreRow.technical_score],['fundamental','基本面',scoreRow.fundamental_score],
    ['capital','资金',scoreRow.capital_score],['industry','行业',scoreRow.industry_score]].map(([key,title,v])=>{
      const n=identity?first(scores[key],v):null;
      return {key,title,value:n!==null&&n>=0&&n<=100?n:null,unit:'分',group:'factor'};
    });
  // Same six axes as desktop recommendation_panel, not pressure-risk inversion.
  const radar=[['trend','趋势'],['technical','技术'],['valuation','估值'],['fundamental','基本面'],['risk','风险韧性'],['momentum','动量']]
    .map(([key,title])=>{const n=identity?observedNumber(scores[key]):null;
      return {key,title,value:n!==null&&n>=0&&n<=100?n:null,unit:'分',group:'radar'};});
  const context=obj(capital.kline_context);
  const ownQuote=businessDate(quote.trade_date)===day?quote:{};
  const movement=[['day_return','当日涨跌',first(ownQuote.change_percent,ownQuote.pct_change,board.pct_change),'%'],
    ['return_5d','近5日变化',first(context.pct_5d),'%'],['return_20d','近20日变化',first(context.pct_20d),'%'],
    ['volume_ratio','量比',first(board.volume_ratio,context.volume_ratio),'倍']]
    .map(([key,title,value,unit])=>({key,title,value:value!==null&&(key==='volume_ratio'?value>=0:value>=-100)?value:null,unit,group:'movement'}));
  const f=financialDisplayInputs(financial,code,day),p=obj(fundamental);
  // Statement rows have their own period and announcement guards.  Do not
  // discard them merely because the summary metric row is unavailable.
  const statements=financialStatementInputs(obj(financial).statement_rows,code,day,f.report_date);
  const aligned=!f.report_date||statements.statement_report_date===businessDate(f.report_date)?statements:{};
  const merged={...f,...Object.fromEntries(Object.entries(aligned).filter(([,v])=>v!==null&&v!==''))};
  const history=(Array.isArray(financial.history)?financial.history:[]).map(r=>financialDisplayInputs(r,code,day))
    .filter(r=>exactRaw(r,code,day));
  const byPeriod=new Map();
  for(const r of history) {
    const point={period:businessDate(r.report_date),revenue_growth:observedNumber(r.revenue_growth),profit_growth:observedNumber(r.profit_growth)};
    if(byPeriod.has(point.period) && JSON.stringify(byPeriod.get(point.period))!==JSON.stringify(point)) byPeriod.set(point.period,null);
    else if(!byPeriod.has(point.period)) byPeriod.set(point.period,point);
  }
  const rules=[
    ['roe','净资产收益率','%', 'profitability',first(merged.roe)],
    // Tushare's legacy `gross_margin` field is an amount, not a percentage.
    // Only the aligned three-statement derivation or the explicit
    // `grossprofit_margin` ratio may populate the percentage card.
    ['gross_margin','毛利率','%', 'profitability',first(aligned.gross_margin,merged.grossprofit_margin)],
    ['operating_margin','营业利润率','%', 'profitability',first(merged.operating_margin)],
    ['net_margin','净利率','%', 'profitability',first(merged.net_margin,merged.netprofit_margin)],
    ['revenue_growth','营收同比','%', 'growth',first(merged.revenue_growth)],
    ['profit_growth','净利润同比','%', 'growth',first(merged.profit_growth)],
    ['eps','每股收益','元/股','cash',first(merged.eps)],
    ['ocfps','每股经营现金流','元/股','cash',first(merged.operating_cashflow_per_share)],
    ['operating_cashflow','经营现金流','元','cash',first(merged.operating_cashflow)],
    ['cash_conversion','现金利润覆盖','%', 'cash',first(merged.cash_conversion)],
    ['net_cash_increase','现金净增加','元','cash',first(merged.net_cash_increase)],
    ['debt_to_assets','资产负债率','%', 'balance',first(merged.debt_to_assets)],
    ['current_ratio','流动比率','倍','balance',first(merged.current_ratio)],
    ['quick_ratio','速动比率','倍','balance',first(merged.quick_ratio)],
    ['cash_to_current_liabilities','现金短债比','倍','balance',first(merged.cash_to_current_liabilities)],
    ['pe','市盈率','倍','valuation',first(p.pe,merged.pe)],['pb','市净率','倍','valuation',first(p.pb,merged.pb)],
    ['revenue','营业收入','元','scale',first(merged.revenue)],['net_profit','净利润','元','scale',first(merged.net_profit)]];
  return {version:'stock-detail-visuals.v1',code,business_date:day,display_only:true,dimensions,radar,movement,
    report_date:businessDate(merged.report_date||merged.statement_report_date),report_publish_date:businessDate(merged.report_publish_date),
    financial_available_date:businessDate(merged.data_available_date),
    financial_conclusion:merged.financial_conclusion||'',financial_confidence:merged.financial_confidence||'',
    financial_history:[...byPeriod.values()].filter(Boolean).sort((a,b)=>a.period.localeCompare(b.period)).slice(-8),
    financial:rules.map(([key,title,unit,group,value])=>({key,title,unit,group,value})),
    labels:[{key:'capital',title:'资金',value:label(capital.label||capital.signal)},
      {key:'sector',title:'板块',value:label(sector.label)},{key:'market',title:'市场',value:label(model.market_state||model.model_label)}]};
}
