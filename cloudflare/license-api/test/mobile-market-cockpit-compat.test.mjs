import assert from "node:assert/strict";
import test from "node:test";
import { __mobilePresentationTest as presentation } from "../src/worker.js";

test("desktop cockpit does not require mobile to invent an empty market score", () => {
  const payload = presentation.mobileMarketCenterPayload({});
  assert.equal(payload.overview.score, null);
  assert.equal(payload.overview.score_label, "待评估");
  assert.deepEqual(payload.score_trend, []);
});

test("mobile retains an observed zero market score", () => {
  const payload = presentation.mobileMarketCenterPayload({
    scoreRows: [{trade_date: "2026-09-11", market_score: 0}],
  });
  assert.equal(payload.overview.score, 0);
  assert.equal(payload.overview.score_label, "0 分");
});

test("sentiment and request dates cannot replace formal evidence", () => {
  const r = presentation.mobileMarketCenterPayload({sentimentRows:[{sentiment_score:90,trade_date:"2026-09-12"}], flowRows:[{main_net:0,trade_date:"2026-09-11"}]});
  assert.equal(r.overview.score,null);
  assert.equal(r.block_dates.score,null);
  assert.equal(r.data_dates.capital,"2026-09-11");
  assert.equal(r.data_dates.sentiment,"2026-09-12");
  assert.equal(r.overview.phase,"未知");
  const formal = presentation.publishedMarketRegime({market_score:23,score_status:"blocked",trade_date:"2026-09-10"});
  assert.equal(formal.market_score,23);
  assert.equal(formal.score_source,"market_score_daily");
  const view = presentation.mobileMarketPresentation({sections:{regime:formal},summary:{score:80},as_of:"2026-09-12"});
  assert.equal(view.score_observation.value,23);
  assert.equal(view.score_observation.status,"blocked");
  assert.equal(view.block_dates.score,"2026-09-10");
  assert.equal(view.score_observation.summary_conflict,true);
});
