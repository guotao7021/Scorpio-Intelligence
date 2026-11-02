import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { __mobilePresentationTest as view } from "../src/worker.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  const queries = [];
  db.exec(`CREATE TABLE production_upload_batches (batch_id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE production_table_rows (
      table_name TEXT, row_key TEXT, row_hash TEXT, row_json TEXT, data_date TEXT,
      edition_scope TEXT, module TEXT, batch_id TEXT, updated_at TEXT,
      PRIMARY KEY (table_name, row_key, edition_scope));
    CREATE INDEX idx_production_table_rows_lookup
      ON production_table_rows (table_name, edition_scope, data_date);
    INSERT INTO production_upload_batches VALUES ('ready','committed'), ('pending','staging');`);
  const env = {DB: {prepare(sql) {queries.push(sql); return {bind(...args) {return {
    all: async () => ({results: db.prepare(sql).all(...args)}),
  };}};}}};
  function add(key, scope, overrides = {}, table = "industry_fund_flow_cache", batch = "ready") {
    const row = {industry_name: key, trade_date: "2026-09-11", source: "dc", industry_level: "L2",
      pct_change: 1, net_amount: 100000000, amount_unit: "CNY", ...overrides};
    db.prepare("INSERT INTO production_table_rows VALUES (?,?,?,?,?,?,?,?,?)").run(
      table, key, key + scope, JSON.stringify(row), row.trade_date, scope, "market_context", batch, "2026-09-12T10:00:00");
  }
  return {db, env, add, queries};
}

test("delivery copies resolve before limit, ranking and all industry/capital aggregates", async () => {
  const {db, env, add} = fixture();
  try {
    for (let i = 0; i < 90; i++) {
      for (const scope of ["pro", "standard_pro", "standard"]) add(`行业${String(i).padStart(2, "0")}`, scope);
    }
    const rows = await view.publishedRows(env, "industry_fund_flow_cache", {edition: "personal_pro"}, {limit: 240});
    assert.equal(rows.length, 90);  // 270 delivery copies must not occupy the limit
    assert.ok(rows.every(r => r._edition_scope === "pro"));
    const payload = view.mobileMarketCenterPayload({industryRows: rows});
    assert.equal(payload.industry_overview.sample_count, 90);
    assert.equal(payload.industry_overview.rise_count, 90);
    assert.equal(payload.industry_overview.conclusion, "行业普涨，资金净流入");
    assert.equal(payload.industry_overview.confidence_score, 95);
    assert.equal(payload.industry_overview.confidence_label, "高");
    assert.equal(payload.industry_overview.total_net, "+90.00 亿元");
    assert.equal(payload.capital.sector_total_net, "+90.00 亿元");
    assert.equal(payload.capital.inflow_count, 90);
    for (const key of ["industries", "leaders", "laggards", "inflows"])
      assert.equal(new Set(payload[key].map(r => r.name)).size, payload[key].length);
    assert.equal(payload.block_dates.industry.row_count, 90);
  } finally {db.close();}
});

test("existing edition authority wins conflicting copies; pending and unauthorized copies stay excluded", async () => {
  const {db, env, add} = fixture();
  try {
    add("银行", "pro", {net_amount: 0});
    add("银行", "standard_pro", {net_amount: 3e8});
    add("待发布", "pro", {}, "industry_fund_flow_cache", "pending");
    add("内部", "internal");
    let rows = await view.publishedRows(env, "industry_fund_flow_cache", {edition: "personal_pro"});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].net_amount, 0);
    rows = await view.publishedRows(env, "industry_fund_flow_cache", {edition: "personal_standard"});
    assert.equal(rows[0].net_amount, 3e8); // still follows existing entitlement scope
  } finally {db.close();}
});

test("one source partition per date; other source rows remain stored rather than merged", async () => {
  const {db, env, add} = fixture();
  try {
    add("dc:银行", "pro", {industry_name: "银行", source: "dc"});
    add("ths:银行", "pro", {industry_name: "银行", source: "ths"});
    add("dc:银行:昨天", "pro", {industry_name: "银行", trade_date: "2026-09-10"});
    add("sector:银行", "pro", {sector_name: "银行"}, "sector_rotation_daily");
    add("sector:银行", "standard", {sector_name: "银行"}, "sector_rotation_daily");
    const rows = await view.publishedRows(env, "industry_fund_flow_cache", {edition: "personal_pro"});
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.source === "dc"));
    const current = await view.publishedRows(env, "industry_fund_flow_cache", {edition: "personal_pro"}, {latest_partition:true});
    assert.equal(current.length, 1);
    assert.equal(current[0].trade_date, "2026-09-11");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM production_table_rows WHERE table_name='industry_fund_flow_cache'").get().n, 3);
    const sectors = await view.publishedRows(env, "sector_rotation_daily", {edition: "personal_pro"});
    assert.equal(sectors.length, 1);
  } finally {db.close();}
});

test("latest sector heat ranks the full 530-row same-day source before top ten", async () => {
  const {db, env, add} = fixture();
  try {
    for (let index = 0; index < 530; index += 1) {
      const code = String(index).padStart(4, "0");
      add(`sector:${code}`, "standard_pro", {
        sector_code: code,
        sector_name: `行业${code}`,
        data_source: "industry_fund_flow_cache",
        hot_score: index === 529 ? 100 : index % 70,
      }, "sector_rotation_daily");
    }
    add("fallback:one", "standard_pro", {
      sector_code: "fallback", sector_name: "其它来源",
      data_source: "stock_daily_latest_industry", hot_score: 100,
    }, "sector_rotation_daily");
    add("old:one", "standard_pro", {
      sector_code: "old", sector_name: "旧日",
      trade_date: "2026-09-10", data_source: "industry_fund_flow_cache", hot_score: 100,
    }, "sector_rotation_daily");
    const rows = await view.publishedLatestSectorRows(env, {edition: "personal_pro"});
    assert.equal(rows.length, 531);
    assert.ok(rows.every((row) => row.trade_date === "2026-09-11"));
    const payload = view.mobileMarketCenterPayload({sectorRows: rows});
    assert.equal(payload.sectors.length, 10);
    assert.equal(payload.sectors[0].sector_code, "0529");
    assert.equal(payload.sectors[0].hot_score, 100);
    assert.deepEqual(payload.sector_heat_meta, {
      business_date: "2026-09-11", source: "industry_fund_flow_cache",
      sector_type: "industry", total_count: 530, displayed_count: 10,
      other_count: 520, status: "available",
    });
    assert.ok(payload.sectors.every((row) => row.sector_type === "industry"));
  } finally {db.close();}
});

test("published sector rows bound every edition stream before version ranking without changing results", async () => {
  const {db, env, add, queries} = fixture();
  try {
    const scopes = ["pro", "standard_pro", "standard"];
    for (let index = 0; index < 60; index += 1) {
      const key = `sector:${String(index).padStart(2, "0")}`;
      for (let scopeIndex = 0; scopeIndex < scopes.length; scopeIndex += 1) {
        const day = 10 + ((index + scopeIndex) % 5);
        add(key, scopes[scopeIndex], {
          industry_name: undefined,
          sector_name: key,
          trade_date: `2026-09-${day}`,
        }, "sector_rotation_daily");
      }
    }

    const rows = await view.publishedRows(
      env,
      "sector_rotation_daily",
      {edition: "personal_pro"},
      {limit: 17},
    );
    const expected = db.prepare(`SELECT row_json, edition_scope FROM (
      SELECT r.*, ROW_NUMBER() OVER (
        PARTITION BY r.table_name, r.module, r.row_key
        ORDER BY r.data_date DESC,
                 CASE r.edition_scope WHEN 'pro' THEN 0 WHEN 'standard_pro' THEN 1 WHEN 'standard' THEN 2 ELSE 99 END,
                 r.updated_at DESC, r.row_hash ASC
      ) AS delivery_rank
      FROM production_table_rows r
      JOIN production_upload_batches b ON b.batch_id = r.batch_id
      WHERE r.table_name = 'sector_rotation_daily'
        AND r.edition_scope IN ('pro', 'standard_pro', 'standard')
        AND b.status = 'committed' AND r.module = 'market_context'
    ) ranked WHERE delivery_rank = 1
    ORDER BY data_date DESC,
             CASE edition_scope WHEN 'pro' THEN 0 WHEN 'standard_pro' THEN 1 WHEN 'standard' THEN 2 ELSE 99 END,
             updated_at DESC, row_key ASC
    LIMIT 17`).all();

    assert.deepEqual(
      rows.map((row) => [row.sector_name, row._edition_scope]),
      expected.map((row) => [JSON.parse(row.row_json).sector_name, row.edition_scope]),
    );
    const sql = queries.at(-1);
    assert.match(sql, /^WITH scope_0 AS \(/);
    assert.match(sql, /scope_1 AS \([\s\S]*scope_2 AS \(/);
    assert.equal((sql.match(/FROM production_table_rows r/g) || []).length, scopes.length);
    assert.ok(sql.indexOf("LIMIT ?") < sql.indexOf("ROW_NUMBER() OVER"));
    assert.doesNotMatch(sql, /CASE r\.edition_scope/);
  } finally {db.close();}
});

test("real incident: older raw Sina plus newer CNY materialization, different IDs, identical displayed amounts", async () => {
  const {db, env, add} = fixture();
  try {
    for (let i=0; i<90; i++) {
      add(`raw:${i}`, "standard_pro", {industry_name:`行业${i}`, source:undefined,
        data_source:"sina", net_amount:36.95, amount_unit:undefined, updated_at:"2026-09-11T00:11:32"});
      add(`view:${i}`, "standard_pro", {industry_name:`行业${i}`, source:undefined,
        data_source:"industry_fund_flow_cache", net_amount:3695000000, amount_unit:undefined, updated_at:"2026-09-11T18:45:27"});
    }
    const rows = await view.publishedRows(env, "industry_fund_flow_cache", {edition:"personal_pro"}, {limit:120});
    assert.equal(rows.length,90);
    assert.ok(rows.every(r=>r.data_source==="industry_fund_flow_cache" && r.amount_unit==="CNY"));
    const payload=view.mobileMarketCenterPayload({industryRows:rows});
    assert.equal(payload.industry_overview.sample_count,90);
    assert.equal(payload.industry_overview.total_net,"+3325.50 亿元");
    assert.equal(payload.industries[0].net,"+36.95 亿元");
    assert.equal(new Set(payload.industries.map(r=>r.name)).size,payload.industries.length);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM production_table_rows").get().n,180);
  } finally {db.close();}
});

test("small unitless industry_fund_flow_cache rows remain displayed as legacy 亿元 values", async () => {
  const {env, add} = fixture();
  add("view:small", "standard_pro", {
    industry_name: "种植业与林业",
    source: undefined,
    data_source: "industry_fund_flow_cache",
    net_amount: 1.23,
    amount_unit: undefined,
    pct_change: 3.33,
    updated_at: "2026-09-17T18:45:27",
  });

  const rows = await view.publishedRows(env, "industry_fund_flow_cache", {edition: "personal_pro"}, {limit: 10});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount_unit, undefined);

  const payload = view.mobileMarketCenterPayload({industryRows: rows});
  assert.equal(payload.industries[0].net, "+1.23 亿元");
  assert.equal(payload.industry_overview.total_net, "+1.23 亿元");
});
