// Published broad-market display subset of data/fund_flow_read_contract.py.
// Historical committed snapshots prefer batch, then marked realtime archives;
// proxies never become a broad-market amount. No new factor or source writes.
import {businessDate} from './market-display-contract.mjs';
const source=r=>String(r.data_source||r.source||'').trim().toLowerCase();
const proxies=new Set(['estimated','industry_fund_flow_proxy','quarantined_non_trading_day_proxy','tencent_sina_combo','ths_individual_fund_flow']);
const role=r=>source(r)==='tushare_moneyflow_mkt_dc'?'batch':source(r)==='eastmoney'?'realtime':proxies.has(source(r))?'proxy':'legacy';
export function publishedMarketFlow(rows=[],{day=null}={}) {
  const candidates=rows.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)&&businessDate(r.trade_date||r.date||r._data_date));
  const target=day?businessDate(day):candidates.map(r=>businessDate(r.trade_date||r.date||r._data_date)).sort().at(-1);
  if(!target)return null;
  const dated=candidates.filter(r=>businessDate(r.trade_date||r.date||r._data_date)===target);
  const known=dated.some(r=>role(r)!=='legacy');
  const eligible=dated.filter(r=>role(r)!=='proxy'&&(!known||role(r)!=='legacy')&&
    (!r.amount_unit||r.amount_unit==='CNY')&&(!r._amount_unit||r._amount_unit==='CNY'));
  const priority={batch:0,realtime:1,legacy:2};
  return eligible.slice().sort((a,b)=>priority[role(a)]-priority[role(b)]||Number(b.id||0)-Number(a.id||0)||source(a).localeCompare(source(b)))[0]||null;
}
