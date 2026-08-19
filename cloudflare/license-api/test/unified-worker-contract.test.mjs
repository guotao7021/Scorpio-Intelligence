import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workerSource = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const wranglerSource = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

test("website deployment preserves the mobile API surface", () => {
  for (const route of [
    'route("POST", "/v1/mobile/authorize"',
    'route("GET", "/v1/mobile/network-check"',
    'route("POST", "/v1/mobile/bootstrap"',
    'route("PUT", "/v1/mobile/portfolio"',
    'route("POST", "/v1/mobile/stock/research"',
    'route("POST", "/v1/mobile/market"',
  ]) {
    assert.match(workerSource, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(wranglerSource, /MOBILE_DAILY_DEEP_ANALYSIS_LIMIT\s*=\s*"5"/);
  assert.match(wranglerSource, /crons\s*=\s*\["\*\/5 \* \* \* \*"\]/);
});

test("unified Worker keeps website delivery and feedback features", () => {
  assert.match(workerSource, /servePublicProductVideo/);
  assert.match(workerSource, /ALIYUN_CDN_DOWNLOAD_ENABLED/);
  assert.match(workerSource, /route\("POST", "\/v1\/feedback\/send-code"/);
  assert.match(workerSource, /route\("GET", "\/v1\/scorpio_v1_admin\/site-analytics"/);
  assert.match(wranglerSource, /PUBLIC_PRODUCT_VIDEO_R2_KEY/);
  assert.match(wranglerSource, /ALIYUN_CDN_DOWNLOAD_HOST/);
});
