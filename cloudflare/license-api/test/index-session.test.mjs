import test from 'node:test';
import assert from 'node:assert/strict';
import {projectIndexSession} from '../src/index-session.mjs';

const now=Date.parse('2026-10-14T14:00:00+08:00');
function row() {
  const series=[['000001','上证指数','SH'],['399001','深证成指','SZ'],['399006','创业板指','SZ']].map(([code,name,exchange])=>({
    code,name,exchange,source:'sina.index_minute',interval_minutes:5,baseline_date:'20261013',baseline_close:100,
    points:['09:30','09:35','11:30','13:00','13:05'].map((clock,i)=>({time:`2026-10-14T${clock}:00+08:00`,close:100+i,pct_change:i}))}));
  return {trade_date:'2026-10-14',snapshot_id:'MIDX-'+'a'.repeat(32),session_json:{schema_version:'market-index-session.v1',display_only:true,
    business_date:'2026-10-14',captured_at:'2026-10-14T13:06:00+08:00',series}};
}
test('three real index curves use folded session coordinates, lunch and missing gaps remain broken',()=>{
  const result=projectIndexSession([row()],now);
  assert.equal(result.series.length,3);assert.equal(result.state_label,'延迟快照');
  const p=result.series[0].points;
  assert.deepEqual(p.map(p=>p.minute_position),[0,5,120,120,125]);
  assert.equal(p[2].break_before,true);assert.equal(p[3].break_before,true);
  assert.equal(result.series[0].baseline_date,'2026-10-13');
  assert.equal(result.series[0].source,undefined);
});
for (const [name,mutate] of [
  ['equity identity',r=>r.session_json.series[0].name='平安银行'],
  ['future capture',r=>r.session_json.captured_at='2026-10-15T13:06:00+08:00'],
  ['mixed day',r=>r.session_json.business_date='2026-10-13'],
  ['duplicate index',r=>r.session_json.series[1]=r.session_json.series[0]],
]) test(`invalid ${name} fails closed without older fallback`,()=>{const r=row();mutate(r);assert.equal(projectIndexSession([r,row()],now).series.length,0)});
for (const [name,mutate] of [
  ['private source',s=>s.source='ifind-mcp'],['bad return',s=>s.points[0].pct_change=9],
  ['lunch point',s=>s.points[0].time='2026-10-14T12:00:00+08:00'],
  ['duplicate point',s=>s.points[1]=s.points[0]],['same day baseline',s=>s.baseline_date='2026-10-14'],
]) test(`${name} excludes affected curve and reports partial`,()=>{const r=row();mutate(r.session_json.series[0]);const result=projectIndexSession([r],now);assert.equal(result.status,'partial');assert.equal(result.missing_count,1)});
test('history is labelled and absent data never becomes a flat zero line',()=>{
  assert.equal(projectIndexSession([row()],now+86400000).state_label,'最近交易日快照');
  assert.deepEqual(projectIndexSession([],now).series,[]);
});
test('lunch is not a delay and an intraday-only upload cannot claim to contain the close',()=>{
  const r=row();r.session_json.captured_at='2026-10-14T11:31:00+08:00';
  r.session_json.series.forEach(s=>s.points=s.points.slice(0,3));
  assert.equal(projectIndexSession([r],Date.parse('2026-10-14T12:30:00+08:00')).state_label,'午间快照');
  assert.equal(projectIndexSession([r],Date.parse('2026-10-14T15:10:00+08:00')).state_label,'日内存档（未含收盘）');
});
