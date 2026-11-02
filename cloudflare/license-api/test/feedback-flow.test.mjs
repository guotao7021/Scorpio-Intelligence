import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createAccountFixture, TEST_JWT_SECRET} from "./helpers/account-fixture.mjs";

const feedback = {type: "bug", product_area: "license", title: "Activation issue", description: "Reproduction and expected behavior", contact_email: "feedback@example.test"};

test("mainland feedback uses its email code even when the production Turnstile secret exists", async (t) => {
  const f = createAccountFixture();
  try {
    f.env.FEEDBACK_TURNSTILE_SECRET = "test-only-turnstile-secret";
    const provider = t.mock.method(globalThis, "fetch", () => { throw new Error("Email feedback must not call Turnstile"); });
    const hash = createHmac("sha256", TEST_JWT_SECRET).update(`${feedback.contact_email}|feedback|123456`).digest("base64url");
    f.sql.prepare("INSERT INTO auth_verification_codes(email,purpose,code_hash,expires_at,created_at) VALUES(?,'feedback',?,?,?)")
      .run(feedback.contact_email, hash, new Date(Date.now() + 600000).toISOString(), new Date().toISOString());
    const request = {method: "POST", anonymous: true, headers: {"CF-IPCountry": "CN"}, body: {...feedback, feedback_verification_code: "123456"}};
    const result = await f.request("/feedback", request);
    assert.equal(result.status, 201); assert.match(result.data.public_id, /^FB-/); assert.equal(provider.mock.callCount(), 0);
    assert.equal((await f.request("/feedback", request)).status, 400);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM feedback_items").get().n, 1);
  } finally { f.close(); }
});

test("international feedback validates a Turnstile token exactly once and does not bypass failed validation", async (t) => {
  const f = createAccountFixture();
  try {
    f.env.FEEDBACK_TURNSTILE_SECRET = "test-only-turnstile-secret";
    let calls = 0;
    const provider = t.mock.method(globalThis, "fetch", async (url) => {
      assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      return Response.json({success: ++calls === 1});
    });
    const request = {method: "POST", anonymous: true, headers: {"CF-IPCountry": "US"}, body: {...feedback, turnstile_token: "test-only-token"}};
    const result = await f.request("/feedback", request);
    assert.equal(result.status, 201); assert.equal(provider.mock.callCount(), 1);
    assert.equal((await f.request("/feedback", {...request, body: {...feedback, turnstile_token: "replayed"}})).status, 403);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM feedback_items").get().n, 1);
  } finally { f.close(); }
});

test("configured Pages origins receive their own CORS header without allowing arbitrary origins", async () => {
  const f = createAccountFixture();
  try {
    f.env.CORS_ALLOWED_ORIGINS = "https://scorpio-intelligence.tech,https://guotao7021.github.io";
    const github = await f.request("/feedback/security", {anonymous: true, headers: {Origin: "https://guotao7021.github.io", "CF-IPCountry": "CN"}});
    assert.equal(github.response.headers.get("access-control-allow-origin"), "https://guotao7021.github.io");
    assert.equal(github.data.mode, "email");
    const other = await f.request("/feedback/security", {anonymous: true, headers: {Origin: "https://not-allowed.example.test"}});
    assert.notEqual(other.response.headers.get("access-control-allow-origin"), "https://not-allowed.example.test");
  } finally { f.close(); }
});
