// Explicit synthetic contract fixture, never a publication or market claim.
export function sessionFixture(day='2026-10-08') {
  const points=Array.from({length:48},(_,i)=>{
    const m=i<24?575+i*5:785+(i-24)*5;
    return {clock:`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,
      median_return_pct:0,mean_return_pct:0,advancing_count:0,declining_count:0,flat_count:5,
      above_vwap_count:0,vwap_valid_count:0,median_pullback_pct:0,amount_yuan:0};
  });
  return {version:'market-session-business.v1',business_date:day,scope:'frozen_stock_pool',baseline:'first_regular_close_0935',
    amount_unit:'CNY',sample_count:5,points,periods:Array.from({length:8},(_,i)=>({start:i===0?'09:30':i===4?'13:00':points[i*6-1].clock,end:points[i*6+5].clock,amount_yuan:0})),
    leadership_retention:null,leaders:[],headline:'股票池午后持平。',chain:['日内强弱','价格承接','成交节奏'].map(title=>({title,fact:'已发生的事实。',reading:'样例解读。',watch:'后续观察方向。'}))};
}
