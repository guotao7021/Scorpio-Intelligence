// Only binds existing stock/day observations. No new financial or risk formula.
import {businessDate} from './market-display-contract.mjs';
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
export function boundStockBehavior({code,day,scoreRow={},details={}}) {
  const p=obj(details.behavior_profile);
  day=businessDate(day);
  const rowDay=businessDate(scoreRow.score_date||scoreRow._data_date);
  const detailDay=businessDate(details.trade_date||details.score_date);
  if(!day || scoreRow.code!==code || p.code!==code || rowDay!==day || detailDay!==day ||
    p.trade_date && businessDate(p.trade_date)!==day) return {};
  // Legacy producer omitted this field. The two owning dates above must agree.
  return {...p,trade_date:day};
}
