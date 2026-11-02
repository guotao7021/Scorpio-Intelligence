import test from "node:test";
import assert from "node:assert/strict";
import {operationsPeriod} from "../src/admin-operations.mjs";
import {createAccountFixture, dayOffset} from "./helpers/account-fixture.mjs";
const path = "/scorpio_v1_admin/operations";
const setup = (t) => { const f = createAccountFixture(); t.after(f.close); return f; };
function visit(f, id, at, visitor, page = "/") {
  f.sql.prepare("INSERT INTO site_visit_events(event_id,event_date,page_path,visitor_hash,user_agent_hash,created_at) VALUES(?,?,?,?,?,?)").run(id, at.slice(0, 10), page, visitor, "fixture", at);
}

test("operations dashboard is administrator-only, bounded and private", async (t) => {
  const f = setup(t);
  assert.equal((await f.request(path, {anonymous: true})).status, 403);
  assert.equal((await f.request(path)).status, 403);
  assert.equal((await f.request(path + "?days=100000", {admin: true})).status, 400);
  const result = await f.request(path, {admin: true});
  assert.equal(result.status, 200); assert.match(result.response.headers.get("cache-control"), /private, no-store/);
  assert.equal(result.data.series.length, 7); assert.equal(result.data.totals.pv, 0); assert.equal(result.data.analysis.avg_latency_ms, null);
  assert.doesNotMatch(JSON.stringify(result.data), /password_hash|signed_payload|fixture-signature|ADMIN_API_TOKEN/);
});

test("period UV deduplicates repeat visitors across pages and days rather than summing daily UV", async (t) => {
  const f = setup(t), now = new Date(Date.now() - 1000).toISOString(), yesterday = new Date(Date.now() - 86401000).toISOString();
  visit(f, "one", yesterday, "same-person", "/"); visit(f, "two", now, "same-person", "/account"); visit(f, "three", now, "other-person", "/");
  const {data} = await f.request(path, {admin: true});
  assert.equal(data.totals.pv, 3); assert.equal(data.totals.uv, 2);
  assert.equal(data.series.reduce((sum, row) => sum + row.uv, 0), 3);
  assert.equal(data.pages.reduce((sum, row) => sum + row.pv, 0), 3);
  assert.equal(data.series.filter((row) => row.pv > 0).length, 2);
  assert.equal(data.snapshot.visits_total, 3); assert.equal(data.snapshot.visitors_total, 2);
});

test("current user and credential coverage excludes archived users while registrations retain history", async (t) => {
  const f = setup(t);
  f.sql.prepare("UPDATE users SET archived_at=? WHERE id=2").run(new Date().toISOString());
  f.sql.prepare("UPDATE users SET email='cf-test@example.com' WHERE id=4").run();
  f.sql.prepare("UPDATE licenses SET expires_at=? WHERE user_id=1 AND activation_code_id=1").run(dayOffset(7));
  const {data} = await f.request(path, {admin: true});
  assert.equal(data.snapshot.users, 2); assert.equal(data.totals.registrations, 3);
  assert.equal(data.snapshot.licensed_users, 1); assert.equal(data.snapshot.valid_credentials, 2);
  assert.equal(data.snapshot.expiring_users, 1); assert.equal(data.expiring.length, 1); assert.equal(data.expiring[0].user_id, 1);
  assert.equal(data.editions[0].users, 1);
});

test("download requests classify Android by platform or legacy APK filename and stay distinct from installs", async (t) => {
  const f = setup(t), now = new Date(Date.now() - 1000).toISOString();
  f.sql.prepare("INSERT INTO release_versions(id,version,channel,edition,platform,r2_key,file_name,released_at) VALUES(10,'1','stable','personal_pro','desktop','one','Setup.exe',?)").run(now);
  f.sql.prepare("INSERT INTO release_versions(id,version,channel,edition,platform,r2_key,file_name,released_at) VALUES(11,'1','beta','all','android','two','Phone.apk',?)").run(now);
  for (const [id, release, filename] of [["a", 10, "Setup.exe"], ["b", 11, "Phone.apk"], ["c", 99, "Legacy.APK"]]) f.sql.prepare("INSERT INTO release_download_events(event_id,event_date,release_id,file_name,created_at) VALUES(?,?,?,?,?)").run(id, now.slice(0, 10), release, filename, now);
  const {data} = await f.request(path, {admin: true});
  assert.equal(data.totals.windows, 1); assert.equal(data.totals.android, 2);
  assert.equal(data.snapshot.windows_downloads_total, 1); assert.equal(data.snapshot.android_downloads_total, 2);
  assert.equal(data.series.reduce((sum, row) => sum + row.windows + row.android, 0), 3);
});

test("reporting boundaries use Shanghai calendar days without changing the license expiry policy", () => {
  const p = operationsPeriod(7, new Date("2026-11-01T16:30:00Z"));
  assert.equal(p.to, "2026-11-02"); assert.equal(p.from, "2026-10-27"); assert.equal(p.start, "2026-10-26T16:00:00.000Z");
  assert.equal(p.end, "2026-11-01T16:30:00.000Z"); assert.equal(p.today_incomplete, true);
});

test("inventory retains record totals while expired used grants cannot inflate available stock or approvals", async (t) => {
  const f = setup(t);
  f.addCode({id: 10, userId: 2, status: "active"}); f.addCode({id: 11, userId: 2, status: "assigned"});
  f.addLicense({id: 6, userId: 2, codeId: 10, expires: dayOffset(-1)});
  f.sql.prepare("UPDATE licenses SET approval_status='pending',is_active=0 WHERE id=6").run();
  const {data} = await f.request(path, {admin: true});
  assert.equal(data.snapshot.codes, 6); assert.equal(data.snapshot.credentials, 6);
  assert.equal(data.snapshot.available_codes, 1); assert.equal(data.queue.pending_credentials, 0);
});
