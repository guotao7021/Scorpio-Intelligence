/** Optional exact-pool display extension. No official index/score/flow inference. */
const finite = (v, min=-Infinity, max=Infinity) => typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;
const count = (v,max) => Number.isInteger(v) && v>=0 && v<=max;
const fields = (v,keys) => v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).every(k=>keys.includes(k));
const text = v => typeof v==='string' && v.trim().length>0 && v.length<=1000;
export function validateMarketSession(s,day) {
  if (!fields(s,['version','business_date','scope','baseline','amount_unit','sample_count','points','periods','leadership_retention','leaders','headline','chain']) ||
      s.version!=='market-session-business.v1' || s.business_date!==day || s.scope!=='frozen_stock_pool' ||
      s.baseline!=='first_regular_close_0935' || s.amount_unit!=='CNY' || !count(s.sample_count,10000) || s.sample_count<5) throw Error('market_session_identity_invalid');
  const clocks = Array.from({length:48},(_,i)=>{
    const minutes = i<24 ? 575+i*5 : 785+(i-24)*5;
    return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  });
  if (!Array.isArray(s.points) || s.points.length!==48) throw Error('market_session_points_invalid');
  s.points.forEach((p,i)=>{
    if (!fields(p,['clock','median_return_pct','mean_return_pct','advancing_count','declining_count','flat_count','above_vwap_count','vwap_valid_count','median_pullback_pct','amount_yuan']) ||
        p.clock!==clocks[i] || !finite(p.median_return_pct,-100) || !finite(p.mean_return_pct,-100) ||
        !finite(p.median_pullback_pct,-100,0) || !finite(p.amount_yuan,0) ||
        !['advancing_count','declining_count','flat_count','above_vwap_count','vwap_valid_count'].every(k=>count(p[k],s.sample_count)) ||
        p.advancing_count+p.declining_count+p.flat_count!==s.sample_count || p.above_vwap_count>p.vwap_valid_count ||
        i===0 && (p.median_return_pct!==0 || p.mean_return_pct!==0 || p.flat_count!==s.sample_count || p.median_pullback_pct!==0)) throw Error('market_session_point_invalid');
  });
  if (!Array.isArray(s.periods) || s.periods.length!==8) throw Error('market_session_periods_invalid');
  s.periods.forEach((p,i)=>{
    const expected=s.points.slice(i*6,i*6+6).reduce((sum,v)=>sum+v.amount_yuan,0);
    if (!fields(p,['start','end','amount_yuan']) || p.start!==(i===0?'09:30':i===4?'13:00':clocks[i*6-1]) || p.end!==clocks[i*6+5] ||
        !finite(p.amount_yuan,0) || Math.abs(expected-p.amount_yuan)>Math.max(1e-6,Math.abs(expected)*1e-10)) throw Error('market_session_period_invalid');
  });
  if (s.leadership_retention!==null && !finite(s.leadership_retention,0,1) || !Array.isArray(s.leaders) || s.leaders.length>3 ||
      s.leaders.some(v=>!fields(v,['name','return_pct']) || !text(v.name) || !finite(v.return_pct,-100)) || !text(s.headline) ||
      !Array.isArray(s.chain) || s.chain.length!==3 || s.chain.some(v=>!fields(v,['title','fact','reading','watch']) || !Object.values(v).every(text) || Object.keys(v).length!==4)) throw Error('market_session_reading_invalid');
  return s;
}
