import test from "node:test";
import assert from "node:assert/strict";
import {createAccountFixture, PREVIEW_PASSWORD, dayOffset} from "./helpers/account-fixture.mjs";
const route = "/scorpio_v1_admin/users/record-action";
const body = (fields) => ({kind: "user", action: "archive", reason: "Remove expired records from the working list", request_id: crypto.randomUUID(), ...fields});

test("archiving a dormant user removes it from normal lists, blocks existing sessions, and can be restored without creating a trial", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  const payload = body({user_id: 2});
  assert.equal((await f.request(route, {method: "POST", body: payload, anonymous: true})).status, 403);
  assert.equal((await f.request(route, {method: "POST", body: payload, admin: true})).status, 200);
  assert.equal((await f.request(route, {method: "POST", body: payload, admin: true})).status, 200);
  const current = await f.request("/scorpio_v1_admin/users?q=newuser", {admin: true}); assert.equal(current.data.page.total, 0);
  const trash = await f.request("/scorpio_v1_admin/users?archived=1&q=newuser", {admin: true}); assert.equal(trash.data.page.total, 1);
  assert.equal((await f.request("/account/overview", {userId: 2})).status, 401);
  assert.equal((await f.request("/auth/login", {method: "POST", anonymous: true, body: {email: "newuser@example.test", password: PREVIEW_PASSWORD}})).status, 401);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM account_license_events WHERE action='archive_user'").get().n, 1);
  assert.equal((await f.request(route, {method: "POST", admin: true, body: body({user_id: 2, action: "restore"})})).status, 200);
  assert.equal((await f.request("/account/overview", {userId: 2})).status, 200);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM activation_codes WHERE assigned_to_user_id=2").get().n, 0);
});

test("an expired grant and its device records enter the recycle bin together without deleting evidence or changing expiry", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  const before = f.sql.prepare("SELECT * FROM licenses WHERE id=4").get();
  const payload = body({kind: "grant", user_id: 3, code_id: 3});
  assert.equal((await f.request(route, {method: "POST", admin: true, body: payload})).status, 200);
  assert.equal((await f.request("/scorpio_v1_admin/authorizations?q=expired", {admin: true})).data.page.total, 0);
  assert.equal((await f.request("/scorpio_v1_admin/authorizations?q=expired&archived=1", {admin: true})).data.page.total, 1);
  const after = f.sql.prepare("SELECT * FROM licenses WHERE id=4").get(); assert.equal(after.expires_at, before.expires_at); assert.equal(after.signed_payload, before.signed_payload); assert.ok(after.archived_at);
  assert.equal((await f.request("/scorpio_v1_admin/users/license-action", {method: "POST", admin: true, body: {user_id: 3, license_id: "LICENSE-4", action: "extend", days: 30, reason: "must restore first", request_id: crypto.randomUUID()}})).status, 409);
  assert.equal((await f.request("/scorpio_v1_admin/licenses/LICENSE-4", {method: "PUT", admin: true, body: {days: 30}})).status, 409);
  assert.equal((await f.request("/scorpio_v1_admin/activation-codes/CODE-3", {method: "PUT", admin: true, body: {status: "active"}})).status, 409);
  assert.equal((await f.request("/license/activate", {method: "POST", userId: 3, body: {activation_code: "CODE-3", machine_fingerprint: "NEW-DEVICE"}})).status, 400);
  assert.equal((await f.request("/account/requests", {method: "POST", userId: 3, body: {license_id: "LICENSE-4", requested_days: 30, request_id: crypto.randomUUID()}})).status, 404);
  assert.equal((await f.request("/account/overview", {userId: 3})).data.licenses.length, 0);
  assert.equal((await f.request(route, {method: "POST", admin: true, body: body({kind: "grant", user_id: 3, code_id: 3, action: "restore"})})).status, 200);
  assert.equal(f.sql.prepare("SELECT archived_at FROM licenses WHERE id=4").get().archived_at, null);
  assert.equal((await f.request("/scorpio_v1_admin/authorizations?q=expired", {admin: true})).data.items[0].status, "expired");
});

test("active grants, unused assigned grants and pending renewals prevent deletion on the server", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  for (const fields of [{user_id: 1}, {user_id: 1, kind: "grant", code_id: 1}]) assert.equal((await f.request(route, {method: "POST", admin: true, body: body(fields)})).status, 409);
  f.addCode({id: 10, userId: 2, status: "assigned"});
  assert.equal((await f.request(route, {method: "POST", admin: true, body: body({user_id: 2})})).status, 409);
  const requested = await f.request("/account/requests", {method: "POST", userId: 3, body: {license_id: "LICENSE-4", requested_days: 30, request_id: crypto.randomUUID()}}); assert.equal(requested.status, 201);
  for (const fields of [{user_id: 3}, {user_id: 3, kind: "grant", code_id: 3}]) assert.equal((await f.request(route, {method: "POST", admin: true, body: body(fields)})).status, 409);
  assert.equal((await f.request(route, {method: "POST", admin: true, body: body({user_id: 1, kind: "grant", code_id: 3})})).status, 404);
});

test("an expiry extension racing with deletion rolls back the archival receipt and keeps the grant visible", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  f.state.beforeBatch = () => f.sql.prepare("UPDATE licenses SET expires_at=? WHERE id=4").run(dayOffset(365));
  const result = await f.request(route, {method: "POST", admin: true, body: body({kind: "grant", user_id: 3, code_id: 3})});
  assert.equal(result.status, 409);
  assert.equal(f.sql.prepare("SELECT archived_at FROM activation_codes WHERE id=3").get().archived_at, null);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM account_operations WHERE action='archive_grant'").get().n, 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM account_license_events WHERE action='archive_grant'").get().n, 0);
});

test("archival completed before a renewal or new grant transaction prevents stale mutations atomically", async (t) => {
  const f = createAccountFixture(); t.after(f.close);
  f.state.beforeBatch = () => f.sql.prepare("UPDATE users SET archived_at=? WHERE id=2").run(new Date().toISOString());
  const assigned = await f.request("/scorpio_v1_admin/users/grant", {method: "POST", admin: true, body: {user_id: 2, edition: "personal_pro", days: 30, max_devices: 1, reason: "race", request_id: crypto.randomUUID()}});
  assert.equal(assigned.status, 409); assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM activation_codes WHERE assigned_to_user_id=2").get().n, 0);
  f.state.beforeBatch = () => f.sql.prepare("UPDATE licenses SET archived_at=? WHERE id=4").run(new Date().toISOString());
  const renewed = await f.request("/account/requests", {method: "POST", userId: 3, body: {license_id: "LICENSE-4", requested_days: 30, request_id: crypto.randomUUID()}});
  assert.equal(renewed.status, 409); assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM account_service_requests WHERE user_id=3").get().n, 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM account_operations").get().n, 0);
});
