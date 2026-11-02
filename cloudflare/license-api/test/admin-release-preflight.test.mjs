import test from "node:test";
import assert from "node:assert/strict";
import {createAccountFixture} from "./helpers/account-fixture.mjs";
const payload = {version: "9.0.0", edition: "personal_pro", channel: "stable", platform: "desktop", r2_key: "releases/windows/setup.exe", file_name: "Setup.exe", file_size_bytes: 0};

test("release preflight is admin-only and verifies the release bucket object without exposing a download URL", async (t) => {
  const f = createAccountFixture(); t.after(f.close); const keys = [];
  f.env.RELEASE_BUCKET = {head: async (key) => { keys.push(key); return {size: 123456, etag: "version-a"}; }};
  assert.equal((await f.request("/scorpio_v1_admin/releases/preflight", {method: "POST", anonymous: true, body: payload})).status, 403);
  const check = await f.request("/scorpio_v1_admin/releases/preflight", {method: "POST", admin: true, body: payload});
  assert.equal(check.status, 200); assert.equal(check.data.file_size_bytes, 123456); assert.equal(check.data.etag, "version-a"); assert.equal(check.data.content_verified, false); assert.deepEqual(keys, [payload.r2_key]);
  assert.equal("download_url" in check.data, false);
});

test("validation refuses missing objects, wrong platform and inconsistent metadata before creating release rows", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  f.env.RELEASE_BUCKET = {head: async () => null};
  assert.equal((await f.request("/scorpio_v1_admin/releases", {method: "POST", admin: true, body: {...payload, require_validation: true}})).status, 404);
  assert.equal((await f.request("/scorpio_v1_admin/releases/preflight", {method: "POST", admin: true, body: {...payload, platform: "android"}})).status, 400);
  f.env.RELEASE_BUCKET.head = async () => ({size: 123, etag: "a"});
  assert.equal((await f.request("/scorpio_v1_admin/releases/preflight", {method: "POST", admin: true, body: {...payload, file_size_bytes: 999}})).status, 409);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM release_versions").get().n, 0);
});

test("a replaced R2 object cannot be published using an old preflight receipt; compatible native publishing remains available", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  f.env.RELEASE_BUCKET = {head: async () => ({size: 123, etag: "new-etag"})};
  const denied = await f.request("/scorpio_v1_admin/releases", {method: "POST", admin: true, body: {...payload, require_validation: true, r2_etag: "old-etag"}}); assert.equal(denied.status, 409);
  const accepted = await f.request("/scorpio_v1_admin/releases", {method: "POST", admin: true, body: {...payload, require_validation: true, r2_etag: "new-etag", file_size_bytes: 123}}); assert.equal(accepted.status, 201);
  const native = await f.request("/scorpio_v1_admin/releases", {method: "POST", admin: true, body: {...payload, version: "9.0.1"}}); assert.equal(native.status, 201);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM release_versions").get().n, 2);
});
