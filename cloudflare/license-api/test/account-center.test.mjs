import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID, createHmac} from "node:crypto";
import {ed25519} from "@noble/curves/ed25519";
import {createAccountFixture, dayOffset, TEST_JWT_SECRET, PREVIEW_PASSWORD} from "./helpers/account-fixture.mjs";
import {effectiveLicenseStatus} from "../src/account-center.mjs";
const adminPath = "/scorpio_v1_admin";
const mutation = (extra) => ({request_id: randomUUID(), ...extra});
const extend = (extra = {}) => mutation({user_id: 1, license_id: "LICENSE-1", action: "extend", days: 30, reason: "Customer renewal", ...extra});

test("overview separates expired licenses from enabled flags and never exposes signed payloads or passwords", async () => {
  const fixture = createAccountFixture();
  try {
    const result = await fixture.request("/account/overview");
    assert.equal(result.status, 200);
    assert.match(result.response.headers.get("cache-control"), /no-store/);
    assert.equal(result.data.summary.active_licenses, 2);
    assert.equal(result.data.licenses.find((item) => item.license_id === "LICENSE-3").status, "expired");
    assert.equal(result.data.devices.length, 4);
    assert.equal(result.data.summary.active_devices, 3);
    assert.doesNotMatch(JSON.stringify(result.data), /password_hash|signed_payload|fixture-signature/);
    assert.equal(effectiveLicenseStatus({is_active: 1, revoked: 0, expires_at: dayOffset(-1)}), "expired");
    assert.equal((await fixture.request("/account/overview?user_id=1", {userId: 2})).data.user.id, 2);
    assert.equal((await fixture.request("/account/overview", {anonymous: true})).status, 401);
  } finally { fixture.close(); }
});

test("registered-user listing includes users without customer records and paginates and filters on the server", async () => {
  const fixture = createAccountFixture();
  try {
    const first = await fixture.request(`${adminPath}/users?limit=2`, {admin: true});
    assert.equal(first.status, 200); assert.equal(first.data.page.total, 4); assert.equal(first.data.page.has_more, true);
    assert.equal((await fixture.request(`${adminPath}/users?status=unlicensed`, {admin: true})).data.items[0].id, 2);
    assert.equal((await fixture.request(`${adminPath}/users?q=researcher`, {admin: true})).data.items.length, 1);
    assert.equal((await fixture.request(`${adminPath}/users?q=%25`, {admin: true})).data.items.length, 0);
    assert.equal((await fixture.request(`${adminPath}/users`, {userId: 1})).status, 403);
    assert.equal((await fixture.request(`${adminPath}/users/detail?user_id=999`, {admin: true})).status, 404);
  } finally { fixture.close(); }
});

test("assigning a grant needs no machine code and retries create exactly one activation code", async () => {
  const fixture = createAccountFixture();
  try {
    const body = mutation({user_id: 2, edition: "personal_pro", days: 365, max_devices: 2, reason: "Confirmed purchase"});
    const first = await fixture.request(`${adminPath}/users/grant`, {admin: true, method: "POST", body});
    assert.equal(first.status, 201);
    const second = await fixture.request(`${adminPath}/users/grant`, {admin: true, method: "POST", body});
    assert.equal(second.data.code, first.data.code);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) AS n FROM activation_codes WHERE assigned_to_user_id = 2").get().n, 1);
    const account = await fixture.request("/account/overview", {userId: 2});
    assert.equal(account.data.summary.status, "unactivated");
    const conflict = await fixture.request(`${adminPath}/users/grant`, {admin: true, method: "POST", body: {...body, days: 730}});
    assert.equal(conflict.status, 409);
  } finally { fixture.close(); }
});

test("extension preserves remaining days and every device binding, re-signs all licenses in its grant, and is idempotent", async () => {
  const fixture = createAccountFixture();
  try {
    const body = extend();
    const before = fixture.sql.prepare("SELECT * FROM licenses WHERE id = 1").get();
    const result = await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body});
    assert.equal(result.status, 200); assert.equal(result.data.affected_licenses, 2); assert.equal(result.data.expires_at, dayOffset(90));
    const rows = fixture.sql.prepare("SELECT * FROM licenses WHERE activation_code_id = 1").all();
    assert.equal(rows[0].machine_fingerprint, before.machine_fingerprint); assert.equal(rows[0].license_id, before.license_id);
    assert.ok(rows.every((item) => item.expires_at === dayOffset(90)));
    const signed = JSON.parse(rows[0].signed_payload), signature = signed.signature; delete signed.signature;
    const canonical = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, val && typeof val === "object" && !Array.isArray(val) ? JSON.parse(canonical(val)) : val])));
    assert.equal(ed25519.verify(Buffer.from(signature.slice(8), "base64url"), new TextEncoder().encode(canonical(signed)), ed25519.getPublicKey(Buffer.alloc(32, 7))), true);
    assert.equal((await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body})).status, 200);
    assert.equal(fixture.sql.prepare("SELECT expires_at FROM licenses WHERE id = 1").get().expires_at, dayOffset(90));
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) AS n FROM account_license_events WHERE action = 'extend'").get().n, 2);
  } finally { fixture.close(); }
});

test("expired extension starts today while revoked licenses require an explicit restore", async () => {
  const fixture = createAccountFixture();
  try {
    const expired = await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body: extend({user_id: 3, license_id: "LICENSE-4"})});
    assert.equal(expired.data.expires_at, dayOffset(30));
    const revoked = await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body: extend({user_id: 4, license_id: "LICENSE-5"})});
    assert.equal(revoked.status, 409);
    assert.equal(fixture.sql.prepare("SELECT revoked FROM licenses WHERE id = 5").get().revoked, 1);
    const restored = await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body: extend({user_id: 4, license_id: "LICENSE-5", action: "restore"})});
    assert.equal(restored.data.expires_at, dayOffset(60));
  } finally { fixture.close(); }
});

test("concurrent expiry changes roll back the whole extension including receipts and events", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.state.beforeBatch = () => fixture.sql.prepare("UPDATE licenses SET expires_at = ? WHERE id = 1").run(dayOffset(120));
    const result = await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body: extend()});
    assert.equal(result.status, 409);
    assert.equal(fixture.sql.prepare("SELECT expires_at FROM licenses WHERE id = 2").get().expires_at, dayOffset(60));
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) AS n FROM account_operations").get().n, 0);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) AS n FROM account_license_events").get().n, 0);
  } finally { fixture.close(); }
});

test("renewal request, approval and user history form an atomic closed loop without repeat approvals", async () => {
  const fixture = createAccountFixture();
  try {
    const body = mutation({license_id: "LICENSE-1", requested_days: 30, note: "Please renew"});
    const first = await fixture.request("/account/requests", {method: "POST", body});
    assert.equal(first.status, 201);
    assert.equal(fixture.sql.prepare("SELECT expires_at FROM licenses WHERE id = 1").get().expires_at, dayOffset(60));
    assert.equal((await fixture.request("/account/requests", {method: "POST", body})).data.public_id, first.data.public_id);
    assert.equal((await fixture.request("/account/requests", {method: "POST", body: {...body, request_id: randomUUID()}})).status, 409);
    const approval = mutation({public_id: first.data.public_id, decision: "approved", reason: "Renewal confirmed"});
    const result = await fixture.request(`${adminPath}/account-requests/resolve`, {admin: true, method: "POST", body: approval});
    assert.equal(result.status, 200);
    assert.equal((await fixture.request(`${adminPath}/account-requests/resolve`, {admin: true, method: "POST", body: approval})).status, 200);
    assert.equal((await fixture.request(`${adminPath}/account-requests/resolve`, {admin: true, method: "POST", body: {...approval, request_id: randomUUID()}})).status, 409);
    const overview = (await fixture.request("/account/overview")).data;
    assert.equal(overview.requests[0].status, "approved"); assert.equal(overview.summary.days_left, 90);
    assert.ok(overview.events.some((item) => item.action === "extend"));
    assert.equal((await fixture.request("/account/requests", {method: "POST", userId: 2, body})).status, 404);
  } finally { fixture.close(); }
});

test("redeem binds only available codes for the verified owner and does not grant extra days", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.addCode({id: 10, userId: 1, status: "assigned"});
    const other = await fixture.request("/account/redeem", {userId: 2, method: "POST", body: mutation({activation_code: "CODE-10"})});
    assert.equal(other.status, 409);
    fixture.addCode({id: 11, userId: null, status: "active"});
    const claim = mutation({activation_code: "CODE-11"});
    assert.equal((await fixture.request("/account/redeem", {userId: 2, method: "POST", body: claim})).status, 200);
    assert.equal((await fixture.request("/account/redeem", {userId: 2, method: "POST", body: claim})).status, 200);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) AS n FROM licenses WHERE user_id = 2").get().n, 0);
  } finally { fixture.close(); }
});

test("mobile binding release is owner-scoped and leaves the commercial license intact", async () => {
  const fixture = createAccountFixture();
  try {
    assert.equal((await fixture.request(`${adminPath}/users/device-action`, {admin: true, method: "POST", body: mutation({user_id: 2, device_id: 1, reason: "Replace phone"})})).status, 404);
    assert.equal((await fixture.request(`${adminPath}/users/device-action`, {admin: true, method: "POST", body: mutation({user_id: 1, device_id: 1, reason: "Replace phone"})})).status, 200);
    assert.equal(fixture.sql.prepare("SELECT revoked FROM mobile_device_bindings WHERE id = 1").get().revoked, 1);
    assert.equal(fixture.sql.prepare("SELECT revoked FROM licenses WHERE id = 1").get().revoked, 0);
    assert.equal((await fixture.request(`${adminPath}/users/license-file?user_id=1&license_id=LICENSE-1`, {admin: true})).status, 200);
    assert.equal((await fixture.request(`${adminPath}/users/license-file?user_id=2&license_id=LICENSE-1`, {admin: true})).status, 404);
  } finally { fixture.close(); }
});

test("verified registration creates the account and trial atomically and keeps the desktop response contract", async () => {
  const fixture = createAccountFixture();
  try {
    const email = "registered@example.test", code = "123456";
    const hash = createHmac("sha256", TEST_JWT_SECRET).update(`${email}|register|${code}`).digest("base64url");
    fixture.sql.prepare("INSERT INTO auth_verification_codes(email,purpose,code_hash,expires_at,created_at) VALUES(?,'register',?,?,?)")
      .run(email, hash, new Date(Date.now() + 600000).toISOString(), new Date().toISOString());
    const body = {email, password: PREVIEW_PASSWORD, verification_code: code};
    const registered = await fixture.request("/auth/register", {method: "POST", anonymous: true, body});
    assert.equal(registered.status, 201); assert.equal(registered.data.trial_license_days, 7);
    assert.ok(registered.data.trial_activation_code);
    const loggedIn = await fixture.request("/auth/login", {method: "POST", anonymous: true, body: {email, password: PREVIEW_PASSWORD, client_edition: "personal_pro"}});
    assert.equal(loggedIn.status, 200); assert.ok(loggedIn.data.access_token);
    assert.equal(loggedIn.data.activation_code, registered.data.trial_activation_code);
    assert.equal((await fixture.request("/auth/register", {method: "POST", anonymous: true, body})).status, 409);
  } finally { fixture.close(); }
});

test("failed trial issuance cannot leave a partially registered account behind", async () => {
  const fixture = createAccountFixture();
  try {
    const email = "rollback@example.test", code = "123456";
    const hash = createHmac("sha256", TEST_JWT_SECRET).update(`${email}|register|${code}`).digest("base64url");
    fixture.sql.prepare("INSERT INTO auth_verification_codes(email,purpose,code_hash,expires_at,created_at) VALUES(?,'register',?,?,?)")
      .run(email, hash, new Date(Date.now() + 600000).toISOString(), new Date().toISOString());
    fixture.sql.exec("CREATE TRIGGER fail_trial BEFORE INSERT ON activation_codes WHEN NEW.notes='auto_registration_trial' BEGIN SELECT RAISE(ABORT,'test trial failure'); END");
    assert.equal((await fixture.request("/auth/register", {method: "POST", anonymous: true, body: {email, password: PREVIEW_PASSWORD, verification_code: code}})).status, 500);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").get(email).n, 0);
  } finally { fixture.close(); }
});

test("a pending replacement grant has the same state in the user center and registered-user listing", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.addCode({id: 20, userId: 3, status: "assigned", edition: "personal_standard"});
    const overview = (await fixture.request("/account/overview", {userId: 3})).data;
    const listing = (await fixture.request(`${adminPath}/users?q=expired`, {admin: true})).data.items[0];
    assert.equal(overview.summary.status, "unactivated"); assert.equal(listing.status, "unactivated");
    assert.equal(overview.summary.edition, listing.edition); assert.equal(listing.expires_at, "");
  } finally { fixture.close(); }
});

test("authorization workbench groups machine credentials, includes unactivated and legacy grants, and filters server-side", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.addCode({id: 20, userId: 2, status: "assigned"});
    fixture.addLicense({id: 21, userId: 2, codeId: null, licenseId: "LEGACY-LICENSE"});
    const listing = await fixture.request(`${adminPath}/authorizations?limit=2`, {admin: true});
    assert.equal(listing.status, 200); assert.equal(listing.data.page.total, 6); assert.equal(listing.data.page.has_more, true);
    assert.equal(listing.data.counts.active, 2); assert.equal(listing.data.counts.unactivated, 1);
    const grouped = await fixture.request(`${adminPath}/authorizations?q=CODE-1`, {admin: true});
    assert.equal(grouped.data.items.length, 1);
    assert.equal((await fixture.request(`${adminPath}/authorizations?status=unactivated`, {admin: true})).data.items[0].user_id, 2);
    assert.equal((await fixture.request(`${adminPath}/authorizations?q=%25`, {admin: true})).data.page.total, 0);
    assert.equal((await fixture.request(`${adminPath}/authorizations`)).status, 403);
    assert.doesNotMatch(JSON.stringify(listing.data), /grant_notes|password_hash|signed_payload/);
  } finally { fixture.close(); }
});

test("unactivated grant edits and pause/resume/revoke/restore are owner-scoped, atomic, idempotent and visible to the member", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.addCode({id: 20, userId: 2, status: "assigned"});
    const body = mutation({user_id: 2, code_id: 20, action: "edit", edition: "personal_standard", days: 180, max_devices: 3, reason: "Updated order"});
    assert.equal((await fixture.request(`${adminPath}/users/code-action`, {admin: true, method: "POST", body})).status, 200);
    assert.equal((await fixture.request(`${adminPath}/users/code-action`, {admin: true, method: "POST", body})).status, 200);
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) AS n FROM account_license_events WHERE action='code_edit'").get().n, 1);
    assert.equal((await fixture.request(`${adminPath}/users/code-action`, {admin: true, method: "POST", body: {...body, request_id: randomUUID(), user_id: 1}})).status, 404);
    for (const [action, expected] of [["suspend", "suspended"], ["resume", "assigned"], ["revoke", "revoked"], ["restore", "assigned"]]) {
      const result = await fixture.request(`${adminPath}/users/code-action`, {admin: true, method: "POST", body: mutation({user_id: 2, code_id: 20, action, reason: "Order review"})});
      assert.equal(result.status, 200); assert.equal(result.data.status, expected);
      const overview = (await fixture.request("/account/overview", {userId: 2})).data;
      assert.equal(overview.activation_codes[0].status, expected); assert.equal(overview.activation_codes[0].license_days, 180);
      if (["suspended", "revoked"].includes(expected)) {
        assert.equal(overview.summary.status, expected); assert.equal(overview.summary.edition, "personal_standard");
        const user = (await fixture.request(`${adminPath}/users?q=newuser`, {admin: true})).data.items[0];
        assert.equal(user.status, expected); assert.equal(user.edition, "personal_standard");
        assert.equal((await fixture.request("/license/activate", {userId: 2, method: "POST", body: {activation_code: "CODE-20", machine_fingerprint: "UNACTIVATED-PC"}})).status, 400);
      }
    }
    const activation = await fixture.request("/license/activate", {userId: 2, method: "POST", body: {activation_code: "CODE-20", machine_fingerprint: "NEW-PC"}});
    assert.equal(activation.status, 201); assert.equal(activation.data.edition, "personal_standard"); assert.equal(activation.data.expires_at, dayOffset(180));
    assert.equal((await fixture.request(`${adminPath}/users/code-action`, {admin: true, method: "POST", body: {...body, request_id: randomUUID()}})).status, 409);
  } finally { fixture.close(); }
});

test("grant edits roll back if a device activates before the batch is applied", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.addCode({id: 20, userId: 2, status: "assigned"});
    fixture.state.beforeBatch = () => fixture.addLicense({id: 20, userId: 2, codeId: 20});
    const result = await fixture.request(`${adminPath}/users/code-action`, {admin: true, method: "POST", body: mutation({user_id: 2, code_id: 20, action: "suspend", reason: "Pause"})});
    assert.equal(result.status, 409);
    assert.equal(fixture.sql.prepare("SELECT status FROM activation_codes WHERE id=20").get().status, "assigned");
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) AS n FROM account_operations").get().n, 0);
  } finally { fixture.close(); }
});

test("revoking the whole grant blocks unused slots and restoration keeps the expiry and machine identities", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.sql.exec("UPDATE activation_codes SET max_devices=3,status='assigned' WHERE id=1");
    const revoke = extend({action: "revoke"});
    assert.equal((await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body: revoke})).status, 200);
    assert.equal(fixture.sql.prepare("SELECT status FROM activation_codes WHERE id=1").get().status, "revoked");
    assert.equal((await fixture.request("/license/activate", {method: "POST", body: {activation_code: "CODE-1", machine_fingerprint: "UNUSED-SLOT"}})).status, 400);
    assert.equal((await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body: extend({action: "restore"})})).status, 200);
    const newDevice = await fixture.request("/license/activate", {method: "POST", body: {activation_code: "CODE-1", machine_fingerprint: "UNUSED-SLOT"}});
    assert.equal(newDevice.status, 201); assert.equal(newDevice.data.expires_at, dayOffset(60));
    const overview = (await fixture.request("/account/overview")).data;
    assert.equal(overview.licenses.filter((row) => row.activation_code === "CODE-1").length, 3);
    assert.ok(overview.licenses.some((row) => row.machine_fingerprint === "PC-1"));
  } finally { fixture.close(); }
});

test("pending software licenses require explicit approval and an approval retry cannot create extra days", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.sql.exec("UPDATE licenses SET is_active=0, approval_status='pending' WHERE activation_code_id=1");
    const body = extend({action: "approve"});
    assert.equal((await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body})).status, 200);
    assert.equal((await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body})).status, 200);
    assert.equal((await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body: {...body, request_id: randomUUID()}})).status, 409);
    assert.ok(fixture.sql.prepare("SELECT * FROM licenses WHERE activation_code_id=1").all().every((row) => row.approval_status === "approved" && row.expires_at === dayOffset(60)));
    assert.equal((await fixture.request("/account/overview")).data.summary.status, "active");
  } finally { fixture.close(); }
});

test("two device credentials in the same grant cannot submit parallel renewal requests", async () => {
  const fixture = createAccountFixture();
  try {
    assert.equal((await fixture.request("/account/requests", {method: "POST", body: mutation({license_id: "LICENSE-2", requested_days: 30})})).status, 201);
    assert.equal((await fixture.request("/account/requests", {method: "POST", body: mutation({license_id: "LICENSE-1", requested_days: 30})})).status, 409);
  } finally { fixture.close(); }
});

test("Android-first activation does not consume the Windows slot or restart the common license term", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.addCode({id: 20, userId: 2, status: "assigned", maxDevices: 1});
    const mobile = await fixture.request("/mobile/authorize", {userId: 2, method: "POST", body: {machine_fingerprint: "ANDROID-NEW", device_label: "Test phone"}});
    assert.equal(mobile.status, 200);
    const code = fixture.sql.prepare("SELECT status FROM activation_codes WHERE id=20").get();
    assert.equal(code.status, "assigned");
    fixture.sql.prepare("UPDATE licenses SET expires_at=? WHERE user_id=2 AND activation_code_id=20").run(dayOffset(40));
    const windows = await fixture.request("/license/activate", {userId: 2, method: "POST", body: {activation_code: "CODE-20", machine_fingerprint: "DESKTOP-NEW"}});
    assert.equal(windows.status, 201); assert.equal(windows.data.expires_at, dayOffset(40));
    assert.equal((await fixture.request("/license/activate", {userId: 2, method: "POST", body: {activation_code: "CODE-20", machine_fingerprint: "DESKTOP-EXTRA"}})).status, 400);
    assert.equal((await fixture.request("/mobile/authorize", {userId: 2, method: "POST", body: {machine_fingerprint: "ANDROID-EXTRA"}})).status, 403);
  } finally { fixture.close(); }
});

test("partly consumed expired grants cannot auto-renew themselves through a new phone or computer", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.sql.exec("UPDATE activation_codes SET status='assigned' WHERE id=3");
    assert.equal((await fixture.request("/mobile/authorize", {userId: 3, method: "POST", body: {machine_fingerprint: "PHONE-AFTER-EXPIRY"}})).status, 403);
    assert.equal((await fixture.request("/license/activate", {userId: 3, method: "POST", body: {activation_code: "CODE-3", machine_fingerprint: "PC-AFTER-EXPIRY"}})).status, 400);
    assert.equal(fixture.sql.prepare("SELECT expires_at FROM licenses WHERE id=4").get().expires_at, dayOffset(-30));
  } finally { fixture.close(); }
});

test("a newly activated device makes a stale group revocation roll back instead of leaving a usable credential", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.state.beforeBatch = () => fixture.addLicense({id: 20});
    const result = await fixture.request(`${adminPath}/users/license-action`, {admin: true, method: "POST", body: extend({action: "revoke"})});
    assert.equal(result.status, 409);
    assert.ok(fixture.sql.prepare("SELECT revoked FROM licenses WHERE activation_code_id=1").all().every((row) => !row.revoked));
    assert.equal(fixture.sql.prepare("SELECT COUNT(*) AS n FROM account_license_events").get().n, 0);
  } finally { fixture.close(); }
});

test("member and registered-user summary both prefer a valid commercial grant over a newer trial", async () => {
  const fixture = createAccountFixture();
  try {
    fixture.addCode({id: 20, note: "auto_registration_trial"}); fixture.addLicense({id: 20, codeId: 20});
    const member = (await fixture.request("/account/overview")).data.summary;
    const admin = (await fixture.request(`${adminPath}/users?q=researcher`, {admin: true})).data.items[0];
    assert.equal(member.status, "active"); assert.equal(member.status, admin.status);
  } finally { fixture.close(); }
});
