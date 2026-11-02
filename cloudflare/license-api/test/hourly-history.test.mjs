import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { validateHourlyHistoryRow, hourlyHistoryPresentation, hourlyRetentionWindow, cleanupHourlyHistory, __productionUploadMaintenanceTest as upload } from "../src/worker.js";
import {hourlyRetentionPredicate} from '../src/hourly-retention.mjs';

function row(date = "2026-09-28") {
  return { code: "600059", trade_date: date, interval_minutes: 60, data_source: "tushare.stk_mins",
    price_basis: "unadjusted", snapshot_id: "test-snapshot", available_at: "2026-09-29T22:00:00",
    updated_at: "2026-09-29T22:00:00", quality_status: "complete",
    bars_json: JSON.stringify(["09:30:00", "10:30:00", "11:30:00", "14:00:00", "15:00:00"].map((time) =>
      ({ bar_time: `${date} ${time}`, open: 10, high: 11, low: 9, close: 10, volume: 100, amount: 1000 }))) };
}

test("only official complete 60min session is accepted for distribution", () => {
  assert.equal(validateHourlyHistoryRow(row()).length, 5);
  for (const change of [{ interval_minutes: 5 }, { data_source: "daily" }, { bars_json: "[]" }, { token: "secret" }]) {
    assert.throws(() => validateHourlyHistoryRow({ ...row(), ...change }));
  }
  const bad = row();
  const bars = JSON.parse(bad.bars_json);
  bars[1].bar_time = "2026-09-28 09:35:00";
  assert.throws(() => validateHourlyHistoryRow({ ...bad, bars_json: JSON.stringify(bars) }));
});

test("mobile hourly history is separate from daily and no fake empty fallback", () => {
  const result = hourlyHistoryPresentation([row("2026-09-29"), row(), row()]);
  assert.equal(result.trend.values.length, 10);
  assert.equal(result.interval_minutes, 60);
  assert.match(result.note, /非实时/);
  assert.doesNotMatch(result.note, /Tushare|tushare|stock_hourly_history|snapshot_id/);
  assert.equal(result.data_source, "tushare.stk_mins"); // retained for validation, not UI copy
  assert.equal(result.trend.dates[0], "2026-09-28 09:30:00");
  assert.equal(result.bars.length,8);
  assert.ok(result.bars.every(b => !b.bar_time.endsWith('09:30:00')));
  assert.equal(result.bars[0].amplitudePct,20);
  assert.deepEqual(Object.keys(result.bars[0]).sort(), ['amplitudePct','bar_time','open','high','low','close','volume'].sort());
  assert.equal(hourlyHistoryPresentation([]).status, "unavailable");
  assert.deepEqual(hourlyHistoryPresentation([]).trend.values, []);
  assert.deepEqual(hourlyHistoryPresentation([]).bars, []);
});

test("new unavailable revision does not expose an old complete session", () => {
  const latest = { ...row(), quality_status: "unavailable", bars_json: "[]" };
  assert.deepEqual(hourlyHistoryPresentation([latest, row()]).trend.values, []);
});

test("retention month uses Shanghai midnight including December rollover", () => {
  assert.deepEqual(hourlyRetentionWindow(new Date("2026-09-30T15:59:59Z")), ["2026-09-01", "2026-10-01"]);
  assert.deepEqual(hourlyRetentionWindow(new Date("2026-09-30T16:00:00Z")), ["2026-10-01", "2026-11-01"]);
  assert.deepEqual(hourlyRetentionWindow(new Date("2026-12-31T16:00:00Z")), ["2027-01-01", "2027-02-01"]);
});

test("cleanup is bounded and deletes only old hourly cloud rows and staging", async () => {
  const calls = [];
  const env = { DB: { prepare(sql) { return { bind(...params) { calls.push({ sql, params });
    return { async run() { return { meta: { changes: 2 } }; } }; } }; } } };
  const result = await cleanupHourlyHistory(env, new Date("2026-09-30T16:00:00Z"));
  assert.equal(result.deleted_rows, 2);
  assert.equal(result.deleted_staging_rows, 2);
  for (const call of calls) {
    assert.match(call.sql, /table_name='stock_hourly_history'/);
    assert.match(call.sql, /LIMIT 20000/);
    assert.equal(call.params[0], '2026-10-01');
    assert.equal(call.params[1], '2026-11-01');
    assert.match(call.sql, /status='committed'/);
    assert.doesNotMatch(call.sql, /DELETE FROM (accounts|portfolio|production_upload_batches)/);
  }
});

test('empty holiday month retains exactly last complete day, per edition, until committed current data', async () => {
  const sql = new DatabaseSync(':memory:');
  try {
    for (const name of ['0008_production_uploads.sql','0009_production_upload_staging.sql'])
      sql.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    sql.exec(readFileSync(new URL('../migrations/0029_hourly_empty_month_retention.sql',import.meta.url),'utf8'));
    sql.function('date',{varargs:true},(...args)=>args.includes('+1 month')?'2026-11-01':'2026-10-01');
    sql.function('julianday',{varargs:true},(value)=>Date.parse(value==='now'?'2026-10-06T05:00:00Z':String(value))/86400000);
    sql.exec("INSERT INTO production_upload_batches (batch_id,module,status,created_at,updated_at) VALUES ('done','market_context','committed','now','now'),('pending','market_context','receiving','now','now')");
    const add = (key, day, edition, quality='complete', batch='done') => {
      const value = {...row(day),quality_status:quality,available_at:`${day}T15:01:00`};
      if (quality !== 'complete') value.bars_json='[]';
      sql.prepare('INSERT INTO production_table_rows VALUES (?,?,?,?,?,?,?,?,?)')
        .run('stock_hourly_history',key,'h',JSON.stringify(value),day,edition,'market_context',batch,'now');
    };
    add('older','2026-09-29','standard_pro');
    add('last-a','2026-09-30','standard_pro');
    add('last-b','2026-09-30','standard_pro');
    add('oct-unavailable','2026-10-01','standard_pro','unavailable');
    add('oct-pending','2026-10-02','standard_pro','complete','pending');
    add('other-edition','2026-09-29','standard');
    sql.prepare("INSERT INTO production_upload_staging_rows VALUES ('pending','stock_hourly_history','pending-fallback','h','{}','2026-09-30','standard_pro','market_context','now')").run();
    const env = {DB:{prepare(text){return {bind(...params){return {
      async first(){return sql.prepare(text).get(...params)||null;},
      async run(){return {meta:{changes:Number(sql.prepare(text).run(...params).changes)}};},
    };}};}}};
    const now = new Date('2026-10-06T05:00:00Z');
    const visible = () => {const p=hourlyRetentionPredicate('r',now);
      return sql.prepare(`SELECT r.row_key FROM production_table_rows r JOIN production_upload_batches b ON b.batch_id=r.batch_id WHERE b.status='committed' AND ${p.sql} ORDER BY row_key`).all(...p.params).map(x=>x.row_key);};
    assert.deepEqual(visible(),['last-a','last-b','oct-unavailable','other-edition']);
    assert.deepEqual(sql.prepare('SELECT trade_date,edition_scope FROM stock_hourly_history ORDER BY trade_date,edition_scope').all().map(x=>[x.trade_date,x.edition_scope]),
      [['2026-09-29','standard'],['2026-09-30','standard_pro'],['2026-09-30','standard_pro'],['2026-10-01','standard_pro']]);
    assert.equal((await cleanupHourlyHistory(env,now)).deleted_rows,1);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM production_upload_staging_rows').get().n,1);
    const batch={edition_scope:'standard_pro',manifest_json:JSON.stringify({tables:[{table_name:'stock_hourly_history',retention_month:'2026-10',retained_previous_date:'2026-09-30'}]})};
    assert.equal(await upload.validateHourlyUploadRetention(env,batch,now),'2026-09-30');
    const payload={batch_id:'x',table_name:'stock_hourly_history',rows:[{row:row('2026-09-30'),data_date:'2026-09-30',row_key:'k',row_hash:'h'}]};
    assert.equal(upload.normalizeProductionUploadChunk(payload,'2026-09-30',now).rows.length,1);
    assert.throws(()=>upload.normalizeProductionUploadChunk(payload,'',now));
    assert.throws(()=>upload.normalizeProductionUploadChunk({...payload,rows:[{...payload.rows[0],data_date:'2026-09-29',row:row('2026-09-29')}]},'2026-09-30',now));
    // A committed usable October day ends only this edition's exception.
    sql.prepare("UPDATE production_upload_batches SET status='committed' WHERE batch_id='pending'").run();
    assert.deepEqual(visible(),['oct-pending','oct-unavailable','other-edition']);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM stock_hourly_history WHERE trade_date='2026-09-30'").get().n,0);
    await assert.rejects(()=>upload.validateHourlyUploadRetention(env,batch,now),/retention_changed/);
    assert.equal((await cleanupHourlyHistory(env,now)).deleted_rows,2);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM production_table_rows WHERE row_key='other-edition'").get().n,1);
  } finally {sql.close();}
});

test("real SQLite cleanup preserves current hourly rows, other datasets and receipts", async () => {
  const sql = new DatabaseSync(":memory:");
  try {
    for (const name of ["0008_production_uploads.sql", "0009_production_upload_staging.sql", "0025_hourly_history_display.sql"]) {
      sql.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    }
    sql.exec("INSERT INTO production_upload_batches (batch_id,module,status,created_at,updated_at) VALUES ('receipt','market_context','committed','now','now')");
    for (const [key, table, date] of [
      ["old", "stock_hourly_history", "2026-09-30"],
      ["current", "stock_hourly_history", "2026-10-01"],
      ["future", "stock_hourly_history", "2026-11-01"],
      ["other", "stock_daily_ohlcv", "2026-08-01"],
    ]) {
      sql.prepare("INSERT INTO production_table_rows VALUES (?,?,?,'{}',?,'standard_pro','market_context','receipt','now')").run(table, key, "h", date);
      sql.prepare("INSERT INTO production_upload_staging_rows VALUES ('receipt',?,?,?,'{}',?,'standard_pro','market_context','now')").run(table, key, "h", date);
    }
    const env = { DB: { prepare(text) { return { bind(...params) {
      return { async run() { return { meta: { changes: Number(sql.prepare(text).run(...params).changes) } }; } };
    } }; } } };
    const result = await cleanupHourlyHistory(env, new Date("2026-09-30T16:00:00Z"));
    assert.equal(result.deleted_rows, 2);
    assert.equal(result.deleted_staging_rows, 2);
    for (const table of ["production_table_rows", "production_upload_staging_rows"]) {
      assert.deepEqual(sql.prepare(`SELECT row_key FROM ${table} ORDER BY row_key`).all().map(r => r.row_key), ["current", "other"]);
    }
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM production_upload_batches").get().n, 1);
    assert.equal((await cleanupHourlyHistory(env, new Date("2026-10-01T01:00:00Z"))).deleted_rows, 0);
    assert.equal(sql.prepare("SELECT type FROM sqlite_master WHERE name='stock_hourly_history'").get().type, "view");
  } finally { sql.close(); }
});
