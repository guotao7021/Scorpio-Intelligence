import assert from "node:assert/strict";
import {CONTRACTS} from "../src/runtime-contract.mjs";

const base = new URL(process.env.SCORPIO_API_ORIGIN || "https://api.scorpio-intelligence.tech");
assert.equal(base.protocol, "https:", "Deployment verification requires HTTPS");

async function check(path, expected, options = {}) {
  const response = await fetch(new URL(path, base), {...options, cache: "no-store", signal: AbortSignal.timeout(30000)});
  assert.equal(response.status, expected, `${options.method || "GET"} ${path}: unexpected HTTP status`);
  const body = await response.json();
  console.log(`${expected} ${options.method || "GET"} ${path}`);
  return body;
}

const health = await check("/health", 200);
assert.equal(health.ok, true);
for (const [name, {version}] of Object.entries(CONTRACTS)) {
  assert.equal(health.contracts?.[name], version, `Missing deployed contract: ${name}. Do not replace the unified Worker with a partial client or website build.`);
}
assert.equal(health.storage?.feedback_screenshots, true, "The private FEEDBACK_BUCKET binding is missing");
const security = await check("/v1/auth/security", 200);
assert.equal(security.mode, "turnstile");
assert.ok(security.site_key);
// Denied requests prove route registration without credentials or business writes.
for (const path of ["users", "authorizations", "account-requests", "operations?days=7", "feedback/detail?id=0", "feedback/attachment?id=0", "storage-budget"]) {
  const body = await check(`/v1/scorpio_v1_admin/${path}`, 403);
  assert.equal(body.error, "admin_token_required");
}
for (const path of ["/v1/account/overview", "/v1/account/feedback"]) await check(path, 401);
for (const path of ["/v1/mobile/bootstrap", "/v2/mobile/portfolio/query"]) {
  await check(path, 401, {method: "POST", headers: {"content-type": "application/json"}, body: "{}"});
}
console.log("Unified website/client API contracts and private screenshot storage verified.");
