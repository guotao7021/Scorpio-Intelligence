import test from "node:test";
import assert from "node:assert/strict";
import {createAccountFixture} from "./helpers/account-fixture.mjs";
import {PNG, issueCode, feedbackBody, multipartFeedback, memoryFeedbackBucket} from "./helpers/feedback-fixture.mjs";
import {readFeedback, UPLOAD_LIMITS} from "../src/feedback-center.mjs";

const headers = {"CF-IPCountry": "CN"};
function setup(t) { const f = createAccountFixture(); t.after(f.close); f.env.FEEDBACK_BUCKET = memoryFeedbackBucket(); return f; }

test("user submission, private screenshot, admin reply and user progress form a complete owner-scoped flow", async (t) => {
  const f = setup(t); issueCode(f);
  const sent = await f.request("/feedback", {method: "POST", headers, body: multipartFeedback({...feedbackBody, user_id: 2})});
  assert.equal(sent.status, 201); assert.equal(sent.data.tracked, true); assert.equal(sent.data.attachment_count, 1); assert.equal(f.env.FEEDBACK_BUCKET.objects.size, 1);
  const list = await f.request("/account/feedback"); assert.equal(list.data.page.total, 1);
  const id = list.data.results[0].id;
  const detail = await f.request(`/account/feedback/detail?id=${id}`);
  const attachment = detail.data.attachments[0]; assert.ok(attachment.attachment_id); assert.doesNotMatch(JSON.stringify(detail.data), /r2_key|admin_notes|client_ip|user_agent/);
  assert.equal((await f.request("/account/feedback", {userId: 2})).data.page.total, 0);
  assert.equal((await f.request(`/account/feedback/detail?id=${id}`, {userId: 2})).status, 404);
  assert.equal((await f.request(`/account/feedback/detail?id=${id}`, {anonymous: true})).status, 401);
  assert.equal((await f.request(`/account/feedback/attachment?id=${attachment.attachment_id}`, {userId: 2})).status, 404);
  assert.equal((await f.request(`/scorpio_v1_admin/feedback/attachment?id=${attachment.attachment_id}`, {anonymous: true})).status, 403);
  const file = await f.request(`/account/feedback/attachment?id=${attachment.attachment_id}`);
  assert.equal(file.status, 200); assert.equal(file.response.headers.get("cache-control"), "private, no-store"); assert.equal(file.response.headers.get("x-content-type-options"), "nosniff"); assert.deepEqual(Buffer.from(await file.response.arrayBuffer()), PNG);
  const adminFile = await f.request(`/scorpio_v1_admin/feedback/attachment?id=${attachment.attachment_id}`, {admin: true}); assert.equal(adminFile.status, 200);
  const updated = await f.request(`/scorpio_v1_admin/feedback/${id}`, {method: "PUT", admin: true, body: {status: "resolved", priority: "high", public_reply: "Expiry display repaired. Please refresh.", admin_notes: "Private diagnosis: never visible to users", updated_at: detail.data.updated_at}});
  assert.equal(updated.status, 200);
  const progress = await f.request(`/account/feedback/detail?id=${id}`); assert.equal(progress.data.status, "resolved"); assert.match(progress.data.public_reply, /repaired/); assert.equal(progress.data.events.length, 2); assert.doesNotMatch(JSON.stringify(progress.data), /Private diagnosis/);
  const admin = await f.request(`/scorpio_v1_admin/feedback/detail?id=${id}`, {admin: true}); assert.match(admin.data.admin_notes, /Private diagnosis/);
  assert.equal((await f.request(`/scorpio_v1_admin/feedback/${id}`, {method: "PUT", admin: true, body: {status: "closed", updated_at: detail.data.updated_at}})).status, 409);
});

test("guest feedback and historical email matches are not claimable by another account", async (t) => {
  const f = setup(t); issueCode(f);
  const sent = await f.request("/feedback", {method: "POST", headers, anonymous: true, body: feedbackBody}); assert.equal(sent.status, 201); assert.equal(sent.data.tracked, false);
  assert.equal((await f.request("/account/feedback")).data.page.total, 0);
  const admin = await f.request("/scorpio_v1_admin/feedback", {admin: true}); assert.equal(admin.data.page.total, 1);
});

test("filters, literal wildcard search and server pagination have account-independent admin access", async (t) => {
  const f = setup(t);
  const now = new Date().toISOString();
  for (let i = 0; i < 4; i++) f.sql.prepare("INSERT INTO feedback_items(public_id,type,product_area,priority,status,title,description,user_id,created_at,updated_at) VALUES(?,'bug','license','normal',?,?,'details',?,?,?)").run(`FB-${i}`, i === 0 ? "resolved" : "new", i === 0 ? "100% done" : `Issue ${i}`, i % 2 + 1, now, now);
  const own = await f.request("/account/feedback?limit=1"); assert.equal(own.data.page.total, 2); assert.equal(own.data.page.has_more, true);
  assert.equal((await f.request("/account/feedback?q=%25")).data.page.total, 1);
  const admin = await f.request("/scorpio_v1_admin/feedback?status=new&type=bug&limit=1&offset=1", {admin: true}); assert.equal(admin.data.page.total, 3); assert.equal(admin.data.results.length, 1); assert.equal(admin.data.metrics.total, 4);
  assert.equal((await f.request("/account/feedback?status=invalid")).status, 400);
});

test("count, size, MIME, SVG and malformed images are rejected before consuming an email code or writing R2", async (t) => {
  const f = setup(t); issueCode(f);
  const image = new File([PNG], "safe.png", {type: "image/png"});
  const cases = [[image, image, image, image], [new File([Buffer.alloc(UPLOAD_LIMITS.file + 1)], "large.png", {type: "image/png"})], [new File(["<svg onload='alert(1)'></svg>"], "image.png", {type: "image/png"})], [new File([PNG], "spoof.jpg", {type: "image/jpeg"})], [new File(["<html>hello</html>"], "image.webp", {type: "image/webp"})]];
  for (const files of cases) assert.equal((await f.request("/feedback", {method: "POST", headers, body: multipartFeedback(feedbackBody, files)})).status, 400);
  assert.equal(f.env.FEEDBACK_BUCKET.objects.size, 0); assert.equal(f.sql.prepare("SELECT consumed_at FROM auth_verification_codes").get().consumed_at, null);
});

test("byte limits cannot be bypassed with a missing or false Content-Length", async () => {
  const encoded = new Uint8Array(UPLOAD_LIMITS.request + 1);
  const request = new Request("https://local.test", {method: "POST", headers: {"content-type": "multipart/form-data; boundary=x", "content-length": "1"}, body: encoded});
  await assert.rejects(readFeedback(request), (error) => error.status === 413);
});

test("failed proofs never write images and failed atomic database saves clean up private R2 objects", async (t) => {
  const f = setup(t);
  assert.equal((await f.request("/feedback", {method: "POST", headers, body: multipartFeedback()})).status, 400); assert.equal(f.env.FEEDBACK_BUCKET.objects.size, 0);
  issueCode(f); f.state.beforeBatch = () => { throw new Error("simulated database outage"); };
  assert.equal((await f.request("/feedback", {method: "POST", headers, body: multipartFeedback()})).status, 500);
  assert.equal(f.env.FEEDBACK_BUCKET.objects.size, 0); assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM feedback_items").get().n, 0);
});

test("private storage must be configured and duplicate screenshots are never silently discarded", async (t) => {
  const f = setup(t); const bucket = f.env.FEEDBACK_BUCKET; delete f.env.FEEDBACK_BUCKET; issueCode(f);
  assert.equal((await f.request("/feedback", {method: "POST", headers, body: multipartFeedback()})).status, 503);
  f.env.FEEDBACK_BUCKET = bucket;
  assert.equal((await f.request("/feedback", {method: "POST", headers, body: multipartFeedback()})).status, 201);
  issueCode(f); const duplicate = await f.request("/feedback", {method: "POST", headers, body: multipartFeedback()}); assert.equal(duplicate.status, 409); assert.equal(duplicate.data.error, "feedback_duplicate_with_attachments"); assert.equal(bucket.objects.size, 1);
});

test("a concurrent admin change cannot create a ghost public reply when the optimistic update fails", async (t) => {
  const f = setup(t); issueCode(f);
  assert.equal((await f.request("/feedback", {method: "POST", headers, body: feedbackBody})).status, 201);
  const row = f.sql.prepare("SELECT * FROM feedback_items").get();
  const fixed = Date.now() + 5000, OriginalDate = Date;
  t.mock.method(Date, "now", () => fixed);
  f.state.beforeBatch = () => f.sql.prepare("UPDATE feedback_items SET status='closed',updated_at=? WHERE id=?").run(new OriginalDate(fixed).toISOString(), row.id);
  const result = await f.request(`/scorpio_v1_admin/feedback/${row.id}`, {method: "PUT", admin: true, body: {status: "resolved", public_reply: "Must not appear", updated_at: row.updated_at}});
  assert.equal(result.status, 409); assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM feedback_events WHERE reply='Must not appear'").get().n, 0);
  assert.equal(f.sql.prepare("SELECT status FROM feedback_items").get().status, "closed");
});
