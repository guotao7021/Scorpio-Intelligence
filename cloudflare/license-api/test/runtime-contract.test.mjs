import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import {CONTRACTS, runtimeHealth} from "../src/runtime-contract.mjs";
import {createAccountFixture} from "./helpers/account-fixture.mjs";
import {memoryFeedbackBucket} from "./helpers/feedback-fixture.mjs";

test("health reports registered website and client contracts without reading business data", async () => {
  const response = await worker.fetch(new Request("https://service.example.test/health"), {FEEDBACK_BUCKET: memoryFeedbackBucket(), DB: {prepare() { assert.fail("health must not query private data"); }}});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  for (const [name, {version}] of Object.entries(CONTRACTS)) assert.equal(body.contracts[name], version, name);
  assert.equal(body.storage.feedback_screenshots, true);
  assert.doesNotMatch(JSON.stringify(body), /admin_token|jwt_secret|license_id|email|database_id|bucket_name/i);
});

test("a partial deployment cannot claim a contract or a missing private storage binding", () => {
  const routes = new Map(Object.values(CONTRACTS).flatMap(({routes}) => routes).map((key) => [key, () => {}]));
  routes.delete("GET /v1/scorpio_v1_admin/users");
  const body = runtimeHealth(routes, {});
  assert.equal(body.contracts.account_center, 0);
  assert.equal(body.contracts.admin_operations, 1);
  assert.equal(body.storage.feedback_screenshots, false);
});

test("the unified runtime serves current admin schemas and denies anonymous reads before touching data", async (t) => {
  const f = createAccountFixture(); t.after(() => f.close()); f.env.FEEDBACK_BUCKET = memoryFeedbackBucket();
  for (const path of ["users", "authorizations", "account-requests", "operations?days=7", "feedback"]) {
    const {response, data: body} = await f.request(`/scorpio_v1_admin/${path}`, {admin: true});
    assert.equal(response.status, 200, path);
    if (path.startsWith("operations")) assert.equal(body.series.length, 7);
    else if (path === "feedback") {
      assert.deepEqual(body.metrics, {total: 0, open: 0, high: 0});
      assert.deepEqual(body.results, []); assert.equal(body.page.total, 0);
    } else assert.ok(Array.isArray(body.items), path);
  }
  for (const [name, {routes}] of Object.entries(CONTRACTS)) for (const key of routes) {
    if (name === "auth_security") continue;
    const [method, path] = key.split(" ");
    const response = await worker.fetch(new Request(`https://service.example.test${path}`, {method,
      ...(["GET", "HEAD"].includes(method) ? {} : {body: "{}", headers: {"content-type": "application/json"}}),
    }), {DB: {prepare() { assert.fail("anonymous reads must not query private data"); }}});
    assert.equal(response.status, path.includes("/scorpio_v1_admin/") ? 403 : 401, key);
  }
});
