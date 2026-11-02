import test from "node:test";
import assert from "node:assert/strict";
import {createAccountFixture, PREVIEW_PASSWORD} from "./helpers/account-fixture.mjs";
import {issueCode} from "./helpers/feedback-fixture.mjs";

const login = {email: "researcher@example.test", password: PREVIEW_PASSWORD};
const browser = {Origin: "https://scorpio-intelligence.tech"};

test("browser login requires a real challenge while native login keeps its response contract", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  t.mock.method(globalThis, "fetch", () => { throw new Error("Missing proof must not contact provider"); });
  const web = await f.request("/auth/login", {method: "POST", anonymous: true, headers: browser, body: login});
  assert.equal(web.status, 400); assert.equal(web.data.error, "auth_challenge_required");
  const labelled = await f.request("/auth/login", {method: "POST", anonymous: true, body: {...login, client_version: "web-account"}});
  assert.equal(labelled.status, 400);
  const native = await f.request("/auth/login", {method: "POST", anonymous: true, body: login});
  assert.equal(native.status, 200); assert.ok(native.data.access_token); assert.ok(native.data.activation_codes);
});

test("browser proofs check success, hostname and action; replay and provider outages fail closed", async (t) => {
  const f = createAccountFixture(); t.after(f.close); f.env.AUTH_TURNSTILE_SECRET = "local-secret";
  let result = {success: true, hostname: "scorpio-intelligence.tech", action: "auth_login"};
  const used = new Set();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const token = options.body.get("response");
    if (token === "network-error") throw new Error("offline");
    if (used.has(token)) return Response.json({success: false, "error-codes": ["timeout-or-duplicate"]});
    used.add(token); return Response.json(result);
  });
  const call = (token) => f.request("/auth/login", {method: "POST", anonymous: true, headers: browser, body: {...login, turnstile_token: token}});
  assert.equal((await call("valid")).status, 200);
  assert.equal((await call("valid")).status, 403);
  result = {...result, hostname: "attacker.test"}; assert.equal((await call("wrong-host")).status, 403);
  result = {...result, hostname: "scorpio-intelligence.tech", action: "auth_register"}; assert.equal((await call("wrong-action")).status, 403);
  assert.equal((await call("network-error")).status, 503);
});

test("missing secret never downgrades browser verification and public policy contains no secrets", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  assert.equal((await f.request("/auth/login", {method: "POST", headers: browser, body: {...login, turnstile_token: "fake"}})).status, 503);
  f.env.AUTH_TURNSTILE_SECRET = "must-not-leak";
  const policy = await f.request("/auth/security", {anonymous: true});
  assert.equal(policy.status, 200); assert.ok(policy.data.site_key); assert.doesNotMatch(JSON.stringify(policy.data), /must-not-leak/);
});

test("native and browser login failures are rate-limited together without storing plaintext email in rate keys", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  for (let i = 0; i < 15; i++) assert.equal((await f.request("/auth/login", {method: "POST", anonymous: true, body: {...login, password: "incorrect"}})).status, 401);
  const blocked = await f.request("/auth/login", {method: "POST", anonymous: true, body: login}); assert.equal(blocked.status, 429);
  assert.ok(f.sql.prepare("SELECT COUNT(*) AS n FROM public_rate_limits WHERE key LIKE '%researcher%'").get().n === 0);
});

test("registration signs in with its own verified response, without reusing a challenge for a second login", async (t) => {
  const f = createAccountFixture(); t.after(f.close); f.env.FEEDBACK_TURNSTILE_SECRET = "test-secret";
  issueCode(f, "registered@example.test", "register");
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json({success: true, hostname: "scorpio-intelligence.tech", action: "auth_register"}));
  const result = await f.request("/auth/register", {method: "POST", anonymous: true, headers: browser, body: {email: "registered@example.test", password: PREVIEW_PASSWORD, verification_code: "123456", turnstile_token: "one-use-proof"}});
  assert.equal(result.status, 201); assert.equal(provider.mock.callCount(), 1); assert.ok(result.data.access_token); assert.ok(result.data.trial_activation_code); assert.equal(result.data.email_verified, true);
});

test("one-time email verification remains single-use under concurrent password reset requests", async (t) => {
  const f = createAccountFixture(); t.after(f.close); issueCode(f, login.email, "reset_password");
  const call = () => f.request("/auth/reset-password", {method: "POST", anonymous: true, body: {email: login.email, verification_code: "123456", new_password: PREVIEW_PASSWORD}});
  const results = await Promise.all([call(), call()]);
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 400]);
});

test("forgot-password shares the email sending quota instead of bypassing it", async (t) => {
  const f = createAccountFixture(); t.after(f.close); f.env.RESEND_API_KEY = "local-key"; f.env.EMAIL_FROM = "preview@example.test";
  t.mock.method(globalThis, "fetch", async () => Response.json({id: "mail-local"}));
  for (let i = 0; i < 3; i++) assert.equal((await f.request("/auth/forgot-password", {method: "POST", anonymous: true, body: {email: login.email}})).status, 200);
  assert.equal((await f.request("/auth/forgot-password", {method: "POST", anonymous: true, body: {email: login.email}})).status, 429);
});
