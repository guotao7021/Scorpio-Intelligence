// Display-only public index curves. Independent of stock-pool minute research
// and formal daily score dates. Fail closed on mixed or inconsistent evidence.
const INDICES = new Map([['000001', ['上证指数','SH']], ['399001',['深证成指','SZ']], ['399006',['创业板指','SZ']]]);
const SOURCES = new Map([['eastmoney.index_minute','东方财富指数分时'], ['sina.index_minute','新浪指数分时']]);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const dayOf = stamp => new Date(stamp + 8*3600000).toISOString().slice(0,10);
function date(value) {
  if (typeof value !== 'string') return '';
  const d = /^\d{8}$/.test(value) ? `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}` : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0,10) === d ? d : '';
}
function instant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}
export function projectIndexSession(rows, now = Date.now()) {
  const empty = {schema_version:'market-index-session.v1',status:'missing',business_date:'',captured_at:'',snapshot_id:'',
    state_label:'分时未更新',message:'尚无已上传的指数分时快照，可刷新重试。',display_only:true,series:[],missing_count:3};
  // Only the latest published partition is eligible. Never fall back after a bad latest head.
  const row = rows?.[0];
  if (!row) return empty;
  let payload;
  try { payload = typeof row.session_json === 'string' ? JSON.parse(row.session_json) : row.session_json; } catch { return empty; }
  const day = date(row.trade_date), captured = instant(payload?.captured_at);
  if (!day || day !== payload?.business_date || day > dayOf(now) || !finite(captured) || captured > now || dayOf(captured) < day ||
      payload.schema_version !== empty.schema_version || payload.display_only !== true || !/^MIDX-[a-f0-9]{32}$/.test(row.snapshot_id || '') ||
      !Array.isArray(payload.series) || payload.series.length > 3) return empty;
  const seen = new Set(), series = [];
  for (const item of payload.series) {
    const expected = INDICES.get(item?.code), baseDay = date(item?.baseline_date);
    if (!expected || seen.has(item.code) || item.name !== expected[0] || item.exchange !== expected[1]) return empty;
    seen.add(item.code);
    if (!SOURCES.has(item.source) || !baseDay || baseDay >= day || !finite(item.baseline_close) || item.baseline_close <= 0 ||
        ![1,5,15,30,60].includes(item.interval_minutes) || !Array.isArray(item.points) || !item.points.length || item.points.length > 500) continue;
    const points = []; let previous = null, valid = true;
    for (const p of item.points) {
      const stamp = instant(p?.time), minute = finite(stamp) ? new Date(stamp + 8*3600000).getUTCHours()*60 + new Date(stamp + 8*3600000).getUTCMinutes() : -1;
      if (!finite(stamp) || stamp > captured || dayOf(stamp) !== day || !(minute >= 570 && minute <= 690 || minute >= 780 && minute <= 900) ||
          !finite(p.close) || p.close <= 0 || !finite(p.pct_change) || Math.abs(p.pct_change - (p.close/item.baseline_close-1)*100) > 0.00001 ||
          previous && stamp <= previous.stamp) { valid = false; break; }
      points.push({time:p.time,clock:new Date(stamp+8*3600000).toISOString().slice(11,16),close:p.close,pct_change:p.pct_change,
        minute_position:minute <= 690 ? minute-570 : minute-660,
        break_before:!!previous && (stamp-previous.stamp > item.interval_minutes*90000 || previous.minute <= 690 && minute >= 780)});
      previous = {stamp,minute};
    }
    if (valid) series.push({code:item.code,name:item.name,source_label:SOURCES.get(item.source),interval_minutes:item.interval_minutes,
      baseline_date:baseDay,baseline_close:item.baseline_close,points});
  }
  const today = dayOf(now), clock = new Date(now+8*3600000), minute = clock.getUTCHours()*60+clock.getUTCMinutes();
  const lastStamp = series.length ? Math.max(...series.map(s=>Date.parse(s.points.at(-1).time))) : 0;
  const delayed = day === today && (minute >= 570 && minute <= 690 || minute >= 780 && minute < 900) && now-lastStamp > 10*60000;
  const hasClose = series.length > 0 && series.every(s=>s.points.at(-1).clock==='15:00');
  return {...empty,business_date:day,captured_at:payload.captured_at,snapshot_id:row.snapshot_id,series,
    status:series.length===3?'available':series.length?'partial':'missing',missing_count:3-series.length,
    state_label:!series.length?'分时未更新':day < today?'最近交易日快照':delayed?'延迟快照':minute>=900?(hasClose?'收盘快照':'日内存档（未含收盘）'):minute>690 && minute<780?'午间快照':'盘中快照',
    message:'指数较前收盘涨跌幅；按上传快照展示，非实时行情，不参与评分或交易准入。'};
}
