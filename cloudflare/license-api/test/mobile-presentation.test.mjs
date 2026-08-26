import assert from "node:assert/strict";
import test from "node:test";

import worker, { __mobilePresentationTest as presentation } from "../src/worker.js";

test("mobile fund and bond search accepts desktop exchange code formats", () => {
  assert.equal(presentation.mobileAssetSearchKeyword("fund", "510300.SH"), "510300");
  assert.equal(presentation.mobileAssetSearchKeyword("fund", "000001.OF"), "000001");
  assert.equal(presentation.mobileAssetSearchKeyword("bond", "SZ123001"), "123001");
  assert.equal(presentation.mobileAssetSearchKeyword("fund", "华夏成长"), "华夏成长");
});

test("mobile data-date catalog exposes published dates in descending order", async () => {
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /score_history/);
        assert.match(sql, /ORDER BY r\.data_date DESC/);
        return {
          bind(...params) {
            assert.ok(params.includes("pro"));
            return {
              all: async () => ({
                results: [
                  { data_date: "2026-08-22" },
                  { data_date: "2026-08-21" },
                ],
              }),
            };
          },
        };
      },
    },
  };
  const dates = await presentation.mobileDataHistoryDates(env, { edition: "personal_pro" });
  assert.deepEqual(dates, ["2026-08-22", "2026-08-21"]);
});

test("mobile fund and bond profile lookups stay below D1 binding limits", async () => {
  const bindCalls = [];
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /json_extract\(r\.row_json, '\$\.fund_code'\)/);
        return {
          bind(...params) {
            assert.equal(params[0], "fund_profiles");
            bindCalls.push(params);
            const codes = params.filter((value) => /^\d{6}$/.test(String(value)));
            return {
              all: async () => ({
                results: codes.map((code) => ({ row_json: JSON.stringify({ fund_code: code, fund_name: `基金${code}` }) })),
              }),
            };
          },
        };
      },
    },
  };
  const codes = Array.from({ length: 161 }, (_, index) => String(index).padStart(6, "0"));
  const profiles = await presentation.loadMobileSampleProfiles(
    env,
    { edition: "personal_pro" },
    "fund_profiles",
    "fund_code",
    codes,
  );

  assert.equal(bindCalls.length, 3);
  assert.ok(bindCalls.every((params) => params.length <= 80));
  assert.equal(profiles.length, codes.length);
  assert.equal(profiles[0].fund_code, "000000");
  assert.equal(profiles.at(-1).fund_code, "000160");
});

test("mobile network probe is public, lightweight, and never cached", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.invalid/v1/mobile/network-check"),
    {},
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("server-timing"), /^worker;dur=/);
  assert.equal(payload.service, "scorpio-mobile-edge");
});

test("mobile bootstrap turns raw market diagnostics into customer copy", () => {
  const payload = presentation.mobileBootstrapPayload({
    user: { id: 1, email: "user@example.invalid" },
    license: { license_id: "LIC-1", edition: "personal_pro", expires_at: "2099-12-31" },
    request: { client_version: "0.1.0" },
    market: {
      status: "ready",
      as_of: "latest_available",
      summary: {
        title: "Market overview",
        brief: "phase=启动 | score=55.0 | capital_direction=capital_outflow",
      },
      sections: {
        regime: {
          phase: "launch",
          market_score: 55,
          score_evidence: {
            indices: [
              { name: "上证指数", close: 3903.72, pct_today: 0.24, pct_5d: 1.1, pct_20d: 3.2, trend: "震荡整理" },
            ],
          },
        },
        capital_flow: { main_net: -12880000000 },
      },
      items: [],
    },
    portfolio: { status: "ready", summary: {}, risk_assessment: {}, next_actions: [] },
    latestPackageRow: null,
    positionCount: 0,
    positions: [],
    watchlist: [{ asset_type: "stock", code: "300750", name: "宁德时代", market: "CN" }],
    sampleItems: [{ code: "600498", name: "烽火通信", score_label: "66.9 分" }],
  });

  assert.equal(payload.home.market_state, "市场处于启动阶段");
  assert.match(payload.home.market_detail, /市场活跃度 55 分/);
  assert.match(payload.home.market_detail, /资金整体偏流出/);
  assert.equal(payload.home.freshness, "数据日期待更新");
  assert.equal(payload.home.data_date, "");
  assert.equal(payload.license.edition_label, "个人专业版");
  assert.equal(payload.portfolio.risk_state, "empty");
  assert.equal(payload.portfolio.cloud_status, "尚未同步组合持仓");
  assert.equal(payload.briefing.headline, "尚未同步组合持仓");
  assert.equal(payload.briefing.events.some((item) => item.title === "组合风险复核"), false);
  assert.equal(payload.home.watchlist[0].code, "300750");
  assert.equal(payload.home.samples[0].code, "600498");
  assert.equal(payload.home.indices[0].name, "上证指数");
  assert.equal(payload.home.indices[0].close, 3903.72);
  assert.equal(payload.compliance.required, true);
  assert.equal(payload.compliance.accepted, false);
  assert.match(payload.compliance.data_delay_notice, /T\+1/);
  assert.match(payload.compliance.investment_notice, /不构成投资建议/);
  assert.doesNotMatch(JSON.stringify(payload.home), /Market overview|phase=|capital_outflow|latest_available/);
});

test("mobile compliance copy is versioned and records acceptance state", () => {
  const pending = presentation.mobileCompliancePayload(false);
  const accepted = presentation.mobileCompliancePayload(true);

  assert.match(pending.version, /^\d{4}-\d{2}-\d{2}\.v\d+$/);
  assert.equal(pending.accepted, false);
  assert.equal(accepted.version, pending.version);
  assert.equal(accepted.accepted, true);
  assert.match(accepted.data_delay_notice, /交易所及持牌机构/);
});

test("market center presents breadth, capital, and sector rotation together", () => {
  const market = presentation.mobileMarketCenterPayload({
    scoreRows: [{
      trade_date: "2026-08-18",
      market_score: 68,
      market_phase: "startup",
      risk_level: "medium",
      evidence_json: JSON.stringify({
        indices: [
          { name: "上证指数", close: 3742.1, pct_today: 0.62, pct_5d: 1.4, pct_20d: 3.8, trend: "震荡偏强" },
          { name: "深证成指", close: 11890.2, pct_today: -0.21, pct_5d: 0.8, pct_20d: 2.1, trend: "震荡" },
        ],
      }),
    }, {
      trade_date: "2026-08-15",
      market_score: 61.5,
      market_phase: "watch",
      score_version: "market.v1",
    }],
    sentimentRows: [{ trade_date: "2026-08-18", total_count: 5000, up_count: 3200, down_count: 1700, flat_count: 100, limit_up_count: 76, limit_down_count: 4, total_amount: 1800000000000 }],
    flowRows: [{ trade_date: "2026-08-18", main_net: -12988000000, super_net: 2988000000, big_net: -15976000000, sh_pct: 0.6, sz_pct: 0.8 }],
    sectorRows: [
      { trade_date: "2026-08-18", sector_name: "半导体", pct_change: 4.85, hot_score: 90, amount: 32238000000 },
      { trade_date: "2026-08-18", sector_name: "消费电子", pct_change: 2.85, hot_score: 80, amount: 5392000000 },
    ],
    industryRows: [
      { trade_date: "2026-08-18", industry_name: "半导体", pct_change: 4.85, net_amount: 322.38, source: "industry_fund_flow_cache", lead_stock: "中芯国际" },
      { trade_date: "2026-08-18", industry_name: "煤炭", pct_change: -2.1, net_amount: -18.2, source: "industry_fund_flow_cache", lead_stock: "中国神华" },
    ],
    briefRows: [{
      trade_date: "2026-08-18",
      title: "震荡偏强，主线仍需资金确认",
      summary: "指数修复，但行业分化仍然明显。",
      body: "## 今日观察\n- 关注量能延续",
      source_name: "雪球公开简报",
      source_url: "https://xueqiu.com/example/1",
      published_at: "2026-08-18T16:00:00+08:00",
    }],
  });

  assert.equal(market.overview.score_label, "68 分");
  assert.equal(market.breadth.up_ratio, "64.0%");
  assert.equal(market.breadth.total_amount, "1.80 万亿元");
  assert.equal(market.capital.main_net, "-129.88 亿元");
  assert.equal(market.freshness, "数据日期 2026-08-18");
  assert.deepEqual(market.sectors.map((item) => item.name), ["半导体", "消费电子"]);
  assert.deepEqual(market.indices.map((item) => item.name), ["上证指数", "深证成指"]);
  assert.equal(market.leaders[0].name, "半导体");
  assert.equal(market.laggards[0].name, "煤炭");
  assert.equal(market.industries.length, 2);
  assert.equal(market.inflows[0].name, "半导体");
  assert.equal(market.outflows[0].name, "煤炭");
  assert.equal(market.industry_overview.mood, "多空均衡");
  assert.equal(market.industry_overview.total_net, "+304.18 亿元");
  assert.equal(market.capital.inflow_count, 1);
  assert.equal(market.capital.outflow_count, 1);
  assert.match(market.overview.dominant_style, /结构强化/);
  assert.deepEqual(market.score_trend.map((item) => item.score), [61.5, 68]);
  assert.equal(market.commentary.external, true);
  assert.equal(market.commentary.source_label, "雪球公开简报");
  assert.equal(market.commentary.body, "今日观察\n• 关注量能延续");
  assert.doesNotMatch(market.advice, /买入|卖出|仓位|建议|积极参与/);
});

test("market commentary falls back to data-derived interpretation without impersonating Xueqiu", () => {
  const market = presentation.mobileMarketCenterPayload({
    scoreRows: [{ trade_date: "2026-08-18", market_score: 52, market_phase: "watch" }],
    flowRows: [{ trade_date: "2026-08-18", main_net: -100000000 }],
  });

  assert.equal(market.commentary.external, false);
  assert.equal(market.commentary.source_label, "市场数据解读");
  assert.match(market.commentary.summary, /资金整体净流出/);
  assert.equal(market.commentary.source_url, "");
});

test("market brief publishing is restricted to the configured administrator", () => {
  const env = { MOBILE_MARKET_BRIEF_ADMIN_EMAILS: "guotao7021@gmail.com" };
  assert.equal(presentation.isMobileBriefAdmin(env, { email: "guotao7021@gmail.com" }), true);
  assert.equal(presentation.isMobileBriefAdmin(env, { email: "reader@example.com" }), false);

  const brief = presentation.normalizeMobileMarketBrief({
    trade_date: "2026-08-20",
    title: "昨日市场简报",
    summary: "公开摘要",
    body: "公开正文",
    source_url: "https://xueqiu.com/example/2",
  }, { email: "guotao7021@gmail.com" });
  assert.equal(brief.brief_id, "mobile-market-brief-2026-08-20");
  assert.equal(brief.source_name, "雪球公开简报");

  const historical = presentation.normalizeMobileMarketBrief({
    trade_date: "2024-02-29",
    title: "历史市场简报",
    body: "补发内容",
  }, { email: "guotao7021@gmail.com" });
  assert.equal(historical.trade_date, "2024-02-29");
  assert.throws(
    () => presentation.normalizeMobileMarketBrief({ trade_date: "2026-02-30", title: "无效日期", body: "内容" }, { email: "guotao7021@gmail.com" }),
    /market_brief_trade_date_invalid/,
  );
  assert.throws(
    () => presentation.normalizeMobileMarketBrief({ trade_date: "2099-01-01", title: "未来日期", body: "内容" }, { email: "guotao7021@gmail.com" }),
    /market_brief_trade_date_future/,
  );
});

test("mobile briefs sort by report date instead of the historical backfill time", () => {
  const briefs = presentation.mobileMarketBriefItems([
    { brief_id: "brief-2026-08-19", trade_date: "2026-08-19", title: "补发简报", body: "正文", published_at: "2026-08-24T10:00:00Z" },
    { brief_id: "brief-2026-08-22", trade_date: "2026-08-22", title: "最新报告", body: "正文", published_at: "2026-08-22T10:00:00Z" },
  ]);

  assert.deepEqual(briefs.map((brief) => brief.trade_date), ["2026-08-22", "2026-08-19"]);
});

test("mobile technical indicators are derived from published OHLCV rows", () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    close: 20 + Math.sin(index / 3) * 2 + index * 0.08,
  }));
  const indicators = presentation.mobileTechnicalIndicators(rows);
  const latest = indicators.points.at(-1);

  assert.equal(indicators.points.length, 40);
  assert.equal(typeof latest.dif, "number");
  assert.equal(typeof latest.dea, "number");
  assert.equal(typeof latest.macd, "number");
  assert.equal(typeof latest.rsi6, "number");
  assert.equal(typeof latest.rsi12, "number");
  assert.equal(typeof latest.rsi24, "number");
  assert.equal(typeof latest.boll_upper, "number");
  assert.equal(typeof latest.boll_mid, "number");
  assert.equal(typeof latest.boll_lower, "number");
  assert.match(indicators.macd_signal, /MACD|DIF/);
  assert.match(indicators.rsi_signal, /RSI6/);
  assert.match(indicators.bollinger_signal, /布林/);
});

test("controlled hybrid mobile snapshots stay display-only and bind cloud analysis", () => {
  const identity = presentation.controlledHybridSnapshotIdentity(
    "stock_quote",
    { code: "600000", as_of: "数据日期 2026-08-21" },
    "cloudflare_quote_gateway",
    "cloud_quote_gateway",
  );
  const contract = presentation.controlledHybridDisplayContract(identity, "mobile");

  assert.equal(identity.business_date, "2026-08-21");
  assert.equal(identity.authority, "cloud_quote_gateway");
  assert.equal(identity.display_only, true);
  assert.equal(identity.formal_use_allowed, false);
  assert.equal(contract.analysis_authority, "cloud_canonical_analysis");
  assert.equal(contract.formal_authority, "cloud_canonical_batch");
  assert.equal(contract.quote_binding_required, true);
  assert.match(contract.display_label, /实时参考/);
});

test("fund presentation keeps missing scores partial and uses unsigned allocation ratios", () => {
  const fund = presentation.mobileFundPayload({
    status: "partial",
    as_of: "2026-08-20T02:00:00.000Z",
    data_quality: { freshness: "2026-08-18" },
    summary: {},
    sections: {
      profile: { fund_code: "000001", fund_name: "测试基金" },
      performance: {},
      exposure: {
        asset_allocation: { stock_ratio: 80, bond_ratio: 15, cash_ratio: 5 },
        holdings: [{ name: "样本持仓", pct: 9.5 }],
      },
    },
  }, { code: "000001", market: "CN" });

  assert.equal(fund.state, "partial");
  assert.equal(fund.header.score, null);
  assert.equal(fund.header.score_label, "待评估");
  assert.equal(fund.as_of, "数据日期 2026-08-18");
  assert.deepEqual(fund.allocation.map((item) => item.value), ["80.00%", "15.00%", "5.00%"]);
  assert.equal(fund.holdings[0].pct, "9.50%");
  assert.equal(fund.header.data_confidence, "部分");
  assert.equal(fund.header.risk_score, null);
  assert.doesNotMatch(fund.conclusion.summary, /Cloud|cache|fallback/i);
});

test("fund presentation exposes only available profile, role, and confidence evidence", () => {
  const fund = presentation.mobileFundPayload({
    status: "ready",
    data_quality: { freshness: "2026-08-18", missing: [] },
    summary: { score: 81 },
    sections: {
      profile: {
        fund_code: "000001",
        fund_name: "测试基金",
        fund_subtype: "mixed",
        asset_role: "core_equity",
        manager: "测试经理",
        company: "测试基金公司",
      },
      performance: { score: 81, risk_score: 62, role_fit_score: 74 },
      exposure: {},
    },
  }, { code: "000001", market: "CN" });

  assert.equal(fund.header.category_label, "混合型");
  assert.equal(fund.header.role_label, "核心权益");
  assert.equal(fund.header.data_confidence, "完整");
  assert.equal(fund.header.risk_score, 62);
  assert.equal(fund.header.role_score, 74);
  assert.deepEqual(fund.profile.slice(0, 4).map((item) => item.value), ["混合型", "核心权益", "测试经理", "测试基金公司"]);
});

test("bond presentation does not fabricate component scores or request-time data dates", () => {
  const bond = presentation.mobileBondPayload({
    status: "partial",
    as_of: "2026-08-20T02:00:00.000Z",
    data_quality: { freshness: "2026-08-18" },
    summary: {},
    sections: {
      detail: { bond_code: "113009", bond_name: "测试转债", credit_rating: "AA" },
      scores: {},
    },
  }, { code: "113009", market: "CN" });

  assert.equal(bond.state, "partial");
  assert.equal(bond.header.score, null);
  assert.equal(bond.header.score_label, "待评估");
  assert.equal(bond.as_of, "数据日期 2026-08-18");
  assert.deepEqual(bond.scores, []);
  assert.doesNotMatch(bond.linkage.summary, /Cloud|cache|fallback/i);
});

test("configured test account has unlimited mobile deep analysis", () => {
  const quota = presentation.mobileDeepAnalysisQuotaPayload(
    { MOBILE_DAILY_DEEP_ANALYSIS_LIMIT: "5", MOBILE_ANALYSIS_UNLIMITED_EMAILS: "guotao7021@gmail.com" },
    { email: "Guotao7021@gmail.com" },
    99,
  );

  assert.equal(quota.unlimited, true);
  assert.equal(quota.used, 0);
  assert.equal(quota.remaining, 5);
});

test("portfolio positions use published quotes and produce visible valuation", () => {
  const positions = presentation.mergeMobilePortfolioPositions([
    { asset_type: "stock", code: "600036", name: "600036", quantity: 100, cost_price: 30, current_price: 0 },
    { asset_type: "fund", code: "000001", name: "华夏成长", quantity: 1000, cost_price: 1, current_price: 0 },
  ], {
    stock: {
      daily: [{ stock_code: "600036.SH", close: 36, trade_date: "2026-08-18" }],
      profiles: [{ code: "SH600036", stock_name: "招商银行" }],
    },
    fund: {
      daily: [{ fund_code: "000001", unit_nav: 1.2, nav_date: "2026-08-18" }],
      profiles: [],
    },
  });

  assert.equal(positions[0].name, "招商银行");
  assert.equal(positions[0].current_price, 36);
  assert.equal(positions[0].price_as_of, "2026-08-18");
  assert.equal(positions[1].current_price, 1.2);

  const analysis = presentation.analysisFallbackPortfolioBundle(
    { positions },
    { feature: "portfolio_analyze", endpoint: "/v1/analysis/portfolio/analyze", user: { id: 1 }, license: { license_id: "L1" } },
  );
  assert.equal(analysis.summary.total_cost, 4000);
  assert.equal(analysis.summary.total_market_value, 4800);
  assert.equal(analysis.summary.total_pnl, 800);
  assert.ok(analysis.risk_assessment.score > 0);
});

test("mobile bootstrap hides cache implementation copy from customers", () => {
  const payload = presentation.mobileBootstrapPayload({
    user: { id: 1, email: "user@example.invalid" },
    license: { license_id: "LIC-1", edition: "personal_pro", expires_at: "2099-12-31" },
    request: { client_version: "0.2.1" },
    market: {
      status: "ready",
      as_of: "2026-08-17",
      summary: {
        title: "大盘分析云端缓存",
        brief: "云端已从已发布缓存返回市场上下文。",
      },
      items: [],
    },
    portfolio: { status: "ready", summary: {}, risk_assessment: {}, next_actions: [] },
    latestPackageRow: null,
    positionCount: 0,
    positions: [],
  });

  assert.equal(payload.home.market_state, "市场以震荡观察为主");
  assert.equal(payload.home.market_detail, "市场状态正在更新，当前资金方向仍待确认。");
  assert.equal(payload.home.data_date, "2026-08-17");
  assert.equal(payload.briefing.data_date, "2026-08-17");
  assert.doesNotMatch(JSON.stringify(payload.home), /云端|缓存|上下文/);
});

test("sample pool is ranked by the score shown to mobile users", () => {
  const items = presentation.rankMobileSamplePoolItems([
    { code: "600001", name: "较低分", total_score: 65.6 },
    { code: "600002", name: "较高分", total_score: 73.7 },
    { code: "600003", name: "中间分", total_score: 67.4 },
  ], "balanced");

  assert.deepEqual(items.map((item) => item.code), ["600002", "600003", "600001"]);
  assert.deepEqual(items.map((item) => item.rank), [1, 2, 3]);
});

test("sample pool preserves distinct strategies when research JSON contains NaN", () => {
  const rows = [
    {
      code: "600001",
      name: "稳健候选",
      total_score: 50,
      public_details: '{"all_strategy_scores":{"conservative":{"total_score":90},"balanced":{"total_score":60},"aggressive":{"total_score":40},"momentum":{"total_score":20}},"behavior_profile":{"board_behavior":{"turnover":NaN}}}',
    },
    {
      code: "600002",
      name: "平衡候选",
      total_score: 50,
      public_details: '{"all_strategy_scores":{"conservative":{"total_score":50},"balanced":{"total_score":90},"aggressive":{"total_score":60},"momentum":{"total_score":40}},"behavior_profile":{"board_behavior":{"turnover":NaN}}}',
    },
    {
      code: "600003",
      name: "进取候选",
      total_score: 50,
      public_details: '{"all_strategy_scores":{"conservative":{"total_score":30},"balanced":{"total_score":50},"aggressive":{"total_score":90},"momentum":{"total_score":70}},"behavior_profile":{"board_behavior":{"turnover":Infinity}}}',
    },
    {
      code: "600004",
      name: "动量候选",
      total_score: 50,
      public_details: '{"all_strategy_scores":{"conservative":{"total_score":20},"balanced":{"total_score":40},"aggressive":{"total_score":70},"momentum":{"total_score":95}},"behavior_profile":{"board_behavior":{"turnover":-Infinity}}}',
    },
  ];

  assert.equal(presentation.rankMobileSamplePoolItems(rows, "conservative")[0].code, "600001");
  assert.equal(presentation.rankMobileSamplePoolItems(rows, "balanced")[0].code, "600002");
  assert.equal(presentation.rankMobileSamplePoolItems(rows, "aggressive")[0].code, "600003");
  assert.equal(presentation.rankMobileSamplePoolItems(rows, "momentum")[0].code, "600004");
});

test("fund and bond sample pools use published metrics without inventing stock scores", () => {
  const funds = presentation.rankMobileAssetSamplePoolItems([
    { fund_code: "000001", fund_name: "低波动基金", score: 66, return_1m_pct: 2.1, return_3m_pct: 5.2, risk_metrics_json: '{"annual_volatility":12.5}' },
    { fund_code: "000002", fund_name: "高动量基金", score: 58, return_1m_pct: 8.1, return_3m_pct: 14.2, risk_metrics_json: '{"annual_volatility":28.5}' },
  ], { asset_type: "fund", strategy: "momentum" });
  const bonds = presentation.rankMobileAssetSamplePoolItems([
    { bond_code: "123001", bond_name: "强势转债", pct_change: 2.5, amount: 12000, price: 121.2, premium_rate: 18.4 },
    { bond_code: "123002", bond_name: "弱势转债", pct_change: -0.6, amount: 21000, price: 109.8, premium_rate: 9.4 },
  ], { asset_type: "bond", strategy: "aggressive" });

  assert.equal(funds[0].code, "000002");
  assert.equal(funds[0].asset_type, "fund");
  assert.equal(funds[0].score_label, "58 分");
  assert.match(funds[0].summary, /近1月/);
  assert.equal(bonds[0].code, "123001");
  assert.equal(bonds[0].asset_type, "bond");
  assert.equal(bonds[0].score_label, "+2.50%");
  assert.match(bonds[0].summary, /价格/);
});

test("industry presentation recognizes sector names and exposes ranked user data", () => {
  const payload = presentation.mobileIndustryPayload({
    status: "ready",
    data_quality: { freshness: "2026-08-14" },
    items: [
      { sector_name: "通信设备", net_amount: 1207000000, pct_change: 1.21, lead_stock: "中兴通讯" },
      { industry_name: "白酒", net_amount: -894000000, pct_change: -1.45, lead_stock: "今世缘" },
    ],
  });

  assert.equal(payload.state, "ready");
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].name, "通信设备");
  assert.equal(payload.items[0].direction, "资金净流入");
  assert.equal(payload.items[0].rank, 1);
  assert.equal(payload.items[0].flow, "+12.07 亿元");
  assert.doesNotMatch(JSON.stringify(payload), /rows=|lead_bucket|sector_name/);
});

test("industry presentation preserves the published 亿元 unit", () => {
  const payload = presentation.mobileIndustryPayload({
    status: "ready",
    items: [
      { industry_name: "半导体", net_amount: 322.38, amount_unit: "亿元", pct_change: 4.85 },
      { industry_name: "电池", net_amount: 39.85, source: "industry_fund_flow_cache", pct_change: 2.33 },
    ],
  });

  assert.equal(payload.items[0].flow, "+322.38 亿元");
  assert.equal(payload.items[1].flow, "+39.85 亿元");
});

test("industry presentation converts production CNY snapshots instead of treating source names as units", () => {
  const payload = presentation.mobileMarketCenterPayload({
    industryRows: [
      { trade_date: "2026-08-19", industry_name: "银行", net_amount: 2630000000, data_source: "sina", pct_change: 0.24 },
      { trade_date: "2026-08-19", industry_name: "半导体", net_amount: -15260000000, data_source: "sina", pct_change: -0.50 },
    ],
  });

  assert.equal(payload.inflows[0].net, "+26.30 亿元");
  assert.equal(payload.outflows[0].net, "-152.60 亿元");
  assert.equal(payload.industry_overview.total_net, "-126.30 亿元");
  assert.equal(payload.capital.sector_total_net, "-126.30 亿元");
});

test("mobile analysis bypasses a recently unhealthy compute origin", async () => {
  const env = {
    ANALYSIS_COMPUTE_URL: "https://compute.example.invalid",
    DB: {
      prepare: () => ({
        first: async () => ({ compute_ok: 0, checked_at: new Date().toISOString() }),
      }),
    },
  };

  assert.equal(await presentation.mobileAnalysisComputeAvailable(env), false);
});

test("mobile analysis retries compute when the health state is stale", async () => {
  const env = {
    ANALYSIS_COMPUTE_URL: "https://compute.example.invalid",
    DB: {
      prepare: () => ({
        first: async () => ({ compute_ok: 0, checked_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }),
      }),
    },
  };

  assert.equal(await presentation.mobileAnalysisComputeAvailable(env), true);
});

test("sample pool and stock research return complete mobile presentation models", () => {
  const publicDetails = {
    total_score: 66.9,
    rating: "风险复核",
    summary: "可观察候选，综合评分 66.9 分",
    all_strategy_scores: { momentum: { total_score: 66.9, rating: "可观察候选" } },
    behavior_profile: {
      name: "烽火通信",
      industry: "通信",
      research_summary: "板块处于启动阶段，资金行为为吸筹，仍需复核风险项。",
      capital_behavior: { label: "吸筹", signal: "positive" },
      sector_lifecycle: { label: "启动", industry: "通信" },
      model_matching: { model_label: "板块轮动模型", market_state: "主线扩散仍在确认" },
      business_positioning: { summary: "通信基础设施核心资产候选" },
      risk: { level: "medium", flags: ["数据质量需复核"] },
      data_quality: { issues: ["部分财务数据更新较慢"] },
    },
  };
  const scoreRow = {
    code: "600498",
    name: "烽火通信",
    group_name: "通信",
    total_score: 66.9,
    technical_score: 55.4,
    fundamental_score: 22.0,
    risk_score: 24,
    score_date: "2026-08-14",
    public_details: JSON.stringify(publicDetails),
  };
  const sample = presentation.mobileSamplePoolItem(scoreRow, "momentum", 0);
  assert.equal(sample.code, "600498");
  assert.equal(sample.score_label, "66.9 分");
  assert.equal(sample.risk_label, "中等");

  const research = presentation.mobileStockResearchPayload({
    status: "ready",
    code: "600498",
    market: "CN",
    sections: {
      quote: { name: "烽火通信", latest_price: 23.15, pct_change: 1.23, trade_date: "2026-08-14" },
      price_technical: { ohlcv: [{ trade_date: "2026-08-13", close: 22.8 }, { trade_date: "2026-08-14", close: 23.15 }] },
      fundamental: { pe: 25.3, pb: 2.1, roe: 8.6 },
    },
  }, scoreRow, { code: "600498", market: "CN" });

  assert.equal(research.name, "烽火通信");
  assert.equal(research.conclusion.title, "风险复核");
  assert.equal(research.movement.factors.length, 4);
  assert.equal(research.trend.values.length, 2);
  assert.ok(research.data.metrics.length >= 5);
  assert.equal(research.profile.items[0].label, "所属行业");
  assert.ok(research.technical.metrics.some((item) => item.label === "技术评分"));
  assert.ok(research.financial.metrics.some((item) => item.label === "市盈率"));
});

test("stock research keeps a usable mobile page when cloud analysis is unavailable", () => {
  const research = presentation.mobileStockResearchUnavailablePayload({ code: "600519", market: "CN" });

  assert.equal(research.code, "600519");
  assert.equal(research.state, "partial");
  assert.equal(research.header.price, "--");
  assert.match(research.conclusion.summary, /稍后刷新/);
  assert.doesNotMatch(JSON.stringify(research), /internal_server_error|edge_fallback_failed/);
});
