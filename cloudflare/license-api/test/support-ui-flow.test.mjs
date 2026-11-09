import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {JSDOM} from "jsdom";
import worker from "../src/worker.js";
import {createAccountFixture, PREVIEW_ADMIN, PREVIEW_PASSWORD} from "./helpers/account-fixture.mjs";
import {issueCode, PNG, memoryFeedbackBucket} from "./helpers/feedback-fixture.mjs";

const publicRoot = new URL("../../../docs/public/", import.meta.url);
const read = (file) => readFileSync(new URL(file, publicRoot), "utf8");
const accountScripts = ["account-i18n.js", "account-center-ui.js", "auth-controls.js", "support-center.js", "account.js"];
const adminScripts = ["account-center-ui.js", "support-center.js", "admin-delivery.js", "admin-overview.js", "admin-accounts.js", "scorpio_v1_admin.js"];
const feedbackScripts = ["account-center-ui.js", "feedback-center-ui.js", "feedback-uploads.js", "feedback.js"];

async function until(check, description) {
  for (let i = 0; i < 600; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.fail(description);
}
function page(t, f, file, scripts, {lang = "zh-CN", auth, admin = false, brokenSecurity = false, responseOverrides = {}, siteRoot = "https://scorpio-intelligence.tech/", hash = ""} = {}) {
  const url = new URL(`${file}${lang === "en" ? "?lang=en" : ""}${hash}`, siteRoot);
  const dom = new JSDOM(read(file), {url, runScripts: "outside-only"});
  f.windows.push(dom.window);
  const w = dom.window, d = w.document, removed = [];
  d.documentElement.lang = lang;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.URL.createObjectURL = () => `blob:test-${crypto.randomUUID()}`;
  w.URL.revokeObjectURL = (value) => removed.push(value);
  w.confirm = () => true;
  w.AbortSignal = AbortSignal;
  w.createImageBitmap = async () => ({width: 1, height: 1, close() {}});
  const DomFormData = w.FormData;
  w.FormData = class extends FormData { constructor(form) { super(); if (form) for (const [key, value] of new DomFormData(form)) if (typeof value === "string") this.append(key, value); } };
  const challenges = new Map();
  w.turnstile = {render(node, options) { const id = challenges.size; challenges.set(id, options); return id; }, reset(id) { challenges.get(id)?.["expired-callback"]?.(); }};
  if (auth) w.localStorage.setItem("scorpio_user_auth", JSON.stringify(auth));
  if (admin) w.sessionStorage.setItem("scorpio_admin_token", PREVIEW_ADMIN);
  w.fetch = async (url, options = {}) => {
    const resolved = new URL(url, w.location.href);
    assert.equal(resolved.hostname, "api.scorpio-intelligence.tech", "UI tests must never contact a live service");
    if (brokenSecurity && resolved.pathname === "/v1/auth/security") throw new Error("local simulated outage");
    if (responseOverrides[resolved.pathname]) return responseOverrides[resolved.pathname]();
    const headers = new Headers(options.headers); headers.set("Origin", "https://scorpio-intelligence.tech"); headers.set("CF-IPCountry", "CN");
    const pending = worker.fetch(new Request(resolved, {...options, headers}), f.env); f.pending.add(pending);
    try { return await pending; } finally { f.pending.delete(pending); }
  };
  const errors = []; w.addEventListener("error", (event) => errors.push(event.error));
  for (const script of scripts) w.eval(read(script));
  return {w, d, errors, removed, proof(tab) { const option = [...challenges.values()].find((value) => value.action === `auth_${tab}`); assert.ok(option); option.callback(`proof-${tab}-${crypto.randomUUID()}`); }};
}
function setup(t) {
  const f = createAccountFixture(); f.windows = []; f.pending = new Set();
  t.after(async () => {
    for (let i = 0; i < 8; i++) { await Promise.allSettled([...f.pending]); await new Promise((resolve) => setTimeout(resolve, 0)); }
    f.windows.forEach((w) => w.close()); f.close();
  });
  f.env.FEEDBACK_BUCKET = memoryFeedbackBucket(); f.env.AUTH_TURNSTILE_SECRET = "test-secret";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const token = options.body.get("response");
    return Response.json({success: true, action: `auth_${token.split("-")[1]}`, hostname: "scorpio-intelligence.tech"});
  }); return f;
}
const set = (ui, id, value) => { const field = ui.d.getElementById(id); field.value = value; field.dispatchEvent(new ui.w.Event("input", {bubbles: true})); };
const click = (ui, id) => ui.d.getElementById(id).click();
const submit = (ui, id) => ui.d.getElementById(id).dispatchEvent(new ui.w.Event("submit", {bubbles: true, cancelable: true}));

for (const [lang, siteRoot, label] of [
  ["zh-CN", "https://www.scorpio-intelligence.tech/", "打开 iPhone 网页版"],
  ["en", "https://guotao7021.github.io/Scorpio-Intelligence/", "Open iPhone web app"],
]) test(`client downloads include the iPhone web app alongside authorized installers (${lang})`, async (t) => {
  const f = setup(t), now = new Date().toISOString();
  const addRelease = f.sql.prepare("INSERT INTO release_versions(version,channel,edition,platform,r2_key,file_name,released_at) VALUES(?,?,?,?,?,?,?)");
  addRelease.run("1.0.1", "stable", "personal_pro", "desktop", "fixtures/Setup.exe", "Setup.exe", now);
  addRelease.run("1.0.2", "beta", "android", "android", "fixtures/Scorpio.apk", "Scorpio.apk", now);
  const ui = page(t, f, "account.html", accountScripts, {lang, siteRoot, hash: "#software-download", auth: {access_token: f.jwt(), email: "researcher@example.test", user_id: 1}});
  const d = ui.d, view = d.querySelector('[data-account-section="downloads"]');
  const windows = d.getElementById("windowsDownloadLink"), android = d.getElementById("androidDownloadLink");
  const iphone = d.getElementById("iphoneWebAppLink");
  await until(() => !windows.hasAttribute("aria-disabled") && !android.hasAttribute("aria-disabled"), "Windows and Android releases loaded");
  assert.equal(view.classList.contains("hidden"), false);
  assert.equal(d.querySelector('[data-account-view="downloads"]').getAttribute("aria-current"), "page");
  assert.equal(view.querySelectorAll(".release-edition-card").length, 3);
  assert.ok(view.contains(iphone));
  assert.equal(iphone.textContent.trim(), label);
  assert.equal(iphone.href, new URL("iphone/", siteRoot).href);
  assert.equal(iphone.hreflang, "zh-CN");
  assert.equal(iphone.hasAttribute("download"), false);
  assert.equal(ui.w.location.hash, "#downloads");
  if (lang === "en") assert.match(iphone.closest("article").textContent, /App in Chinese/);

  f.sql.exec("UPDATE release_versions SET is_active=0");
  click(ui, "refreshRelease");
  await until(() => d.getElementById("androidReleaseBox").classList.contains("is-unavailable"), "unavailable installers indicated");
  assert.equal(windows.getAttribute("aria-disabled"), "true");
  assert.equal(android.getAttribute("aria-disabled"), "true");
  assert.equal(iphone.hasAttribute("aria-disabled"), false);
  assert.equal(iphone.href, new URL("iphone/", siteRoot).href);
  assert.deepEqual(ui.errors, []);
});

test("Chinese login has reversible eye controls, blocks missing proofs and opens My feedback in the same account center", async (t) => {
  const f = setup(t), ui = page(t, f, "account.html", accountScripts);
  await until(() => ui.w.ScorpioAuthControls && ui.d.querySelectorAll(".auth-challenge").length === 3, "auth controls mounted");
  await until(() => ui.d.querySelector(".auth-challenge p").textContent === "", "security policy loaded");
  set(ui, "loginEmail", "researcher@example.test"); set(ui, "loginPassword", PREVIEW_PASSWORD);
  ui.d.querySelector('[aria-controls="loginPassword"]').click(); assert.equal(ui.d.getElementById("loginPassword").type, "text");
  ui.d.querySelector('[aria-controls="loginPassword"]').click(); assert.equal(ui.d.getElementById("loginPassword").type, "password");
  submit(ui, "loginForm"); await until(() => ui.d.getElementById("authMessage").textContent.includes("请先完成安全验证"), "missing challenge error visible");
  ui.proof("login"); submit(ui, "loginForm"); await until(() => !ui.d.getElementById("accountWorkspace").classList.contains("hidden"), "user signed in");
  await until(() => ui.d.getElementById("authMessage").textContent === "登录成功。", "login refresh completed");
  ui.d.querySelector('[data-account-view="feedback"]').click(); assert.equal(ui.d.getElementById("portalPageTitle").textContent, "我的反馈");
  assert.equal(ui.d.getElementById("supportCenterView").classList.contains("hidden"), false); assert.deepEqual(ui.errors, []);
});

test("English registration, confirmation errors and verification loading failures use the same guarded controls", async (t) => {
  const f = setup(t), ui = page(t, f, "account.html", accountScripts, {lang: "en", brokenSecurity: true});
  await until(() => ui.d.querySelector(".auth-challenge p").textContent.includes("unavailable"), "verification failure visible");
  assert.equal(ui.d.querySelector(".auth-challenge button").hidden, false);
  ui.d.querySelector('[data-auth-tab="register"]').click();
  set(ui, "registerPassword", PREVIEW_PASSWORD); set(ui, "registerPasswordConfirm", "different"); assert.equal(ui.d.getElementById("registerPasswordConfirm").checkValidity(), false);
  set(ui, "registerPasswordConfirm", PREVIEW_PASSWORD); assert.equal(ui.d.getElementById("registerPasswordConfirm").checkValidity(), true);
  ui.d.querySelector('[aria-controls="registerPassword"]').click(); assert.equal(ui.d.getElementById("registerPassword").type, "text");
  ui.d.querySelector('[data-auth-tab="reset"]').click(); assert.equal(ui.d.getElementById("registerPassword").type, "password");
  assert.equal(ui.d.querySelector('[aria-controls="resetPassword"]').getAttribute("aria-label"), "Show password");
});

test("verified website registration opens the account center with its trial grant without a second login request", async (t) => {
  const f = setup(t), ui = page(t, f, "account.html", accountScripts, {lang: "en"});
  const paths = [], fetch = ui.w.fetch;
  ui.w.fetch = (url, options) => { paths.push(new URL(url).pathname); return fetch(url, options); };
  ui.d.querySelector('[data-auth-tab="register"]').click();
  await until(() => !ui.d.querySelector('#registerForm .auth-challenge p').textContent, "registration challenge mounted");
  const email = "registration-ui@example.test"; issueCode(f, email, "register");
  set(ui, "registerEmail", email); set(ui, "registerName", "New member"); set(ui, "registerPassword", PREVIEW_PASSWORD); set(ui, "registerPasswordConfirm", PREVIEW_PASSWORD); set(ui, "registerCode", "123456");
  ui.proof("register"); submit(ui, "registerForm");
  await until(() => !ui.d.getElementById("accountWorkspace").classList.contains("hidden"), "registered user signed in");
  await until(() => ui.d.getElementById("activationCode").value, "trial activation code displayed");
  assert.equal(paths.filter((path) => path === "/v1/auth/register").length, 1); assert.equal(paths.includes("/v1/auth/login"), false);
  assert.equal(ui.d.getElementById("registerPassword").value, ""); assert.equal(ui.d.getElementById("registerPasswordConfirm").value, "");
  assert.equal(ui.d.getElementById("sessionEmail").textContent, email); assert.deepEqual(ui.errors, []);
});

test("feedback screenshot selection and removal, submission, embedded admin reply and owner progress use real Worker routes", async (t) => {
  const f = setup(t); const auth = {access_token: f.jwt(), email: "researcher@example.test", user_id: 1};
  const compose = page(t, f, "feedback-cn.html", feedbackScripts, {auth});
  await until(() => !compose.d.getElementById("feedbackEmailVerification").hidden, "regional protection selected");
  set(compose, "fb-title", "续期显示测试（本地隔离）"); click(compose, "feedbackNext");
  set(compose, "fb-description", "申请已经批准，页面未刷新。"); set(compose, "fb-steps", "申请，批准，打开用户中心"); set(compose, "fb-expected", "显示新日期"); set(compose, "fb-actual", "显示旧日期");
  const paste = () => { const event = new compose.w.Event("paste", {bubbles: true, cancelable: true}); Object.defineProperty(event, "clipboardData", {value: {files: [new File([PNG], "test.png", {type: "image/png"})]}}); compose.d.getElementById("feedbackForm").dispatchEvent(event); };
  paste(); await until(() => compose.d.querySelectorAll("#feedbackImagePreviews img").length === 1, "screenshot preview displayed");
  compose.d.querySelector("[data-remove-image]").click(); assert.equal(compose.d.querySelectorAll("#feedbackImagePreviews img").length, 0); assert.equal(compose.removed.length, 1);
  paste(); await until(() => compose.d.querySelectorAll("#feedbackImagePreviews img").length === 1, "screenshot selected again");
  click(compose, "feedbackNext"); issueCode(f); set(compose, "fb-feedback_verification_code", "123456");
  submit(compose, "feedbackForm"); await until(() => !compose.d.getElementById("feedbackReceipt").hidden, "real feedback receipt received");
  assert.equal(f.env.FEEDBACK_BUCKET.objects.size, 1); assert.match(compose.d.getElementById("feedbackReceipt").textContent, /我的反馈/);
  const user = page(t, f, "account.html", accountScripts, {auth});
  await until(() => user.d.querySelector("[data-support-id]"), "owner feedback loaded");
  for (let i = 0; i < 8; i++) { await Promise.allSettled([...f.pending]); await new Promise((resolve) => setTimeout(resolve, 0)); }
  const ownerFetch = user.w.fetch; let releaseList, holdList = true;
  user.w.fetch = async (url, options) => {
    const response = await ownerFetch(url, options);
    if (new URL(url).pathname === "/v1/account/feedback" && holdList) { holdList = false; await new Promise((resolve) => { releaseList = resolve; }); }
    return response;
  };
  const delayedRefresh = user.w.ScorpioSupportCenter.refresh();
  await until(() => releaseList, "background list response held for race test");
  user.d.querySelector('[data-account-view="feedback"]').click(); user.d.querySelector("[data-support-id]").click();
  await until(() => user.d.querySelector("[data-support-image]"), "owner screenshot fetched with authentication");
  releaseList(); await delayedRefresh; user.w.fetch = ownerFetch;
  assert.ok(user.d.querySelector("[data-support-image]"), "late list response must preserve newly opened details and screenshots");
  user.d.querySelector("[data-support-image]").click(); assert.equal(user.d.querySelector(".support-lightbox").open, true);
  user.d.querySelector(".support-lightbox button").click();
  const admin = page(t, f, "scorpio_v1_admin.html", adminScripts, {admin: true, lang: "en"});
  await until(() => admin.d.querySelector("[data-support-id]"), "admin feedback loaded after shared login");
  admin.d.querySelector('[data-account-admin-view="feedback"]').click(); assert.equal(admin.d.getElementById("supportCenterView").classList.contains("hidden"), false);
  assert.equal(admin.d.getElementById("adminLicensesView").classList.contains("hidden"), true);
  admin.d.querySelector("[data-support-id]").click(); await until(() => admin.d.getElementById("supportUpdate"), "admin detail mounted");
  const form = admin.d.getElementById("supportUpdate"); form.elements.status.value = "resolved"; form.elements.public_reply.value = "The expiry display is repaired."; form.elements.admin_notes.value = "INTERNAL-NOT-FOR-USERS";
  submit(admin, "supportUpdate"); await until(() => admin.d.getElementById("supportNotice").textContent.includes("Saved."), "admin saved reply");
  click(user, "supportRefresh"); await until(() => user.d.querySelector(".support-reply")?.textContent.includes("repaired"), "user sees updated status and reply");
  assert.doesNotMatch(user.d.getElementById("supportDetail").textContent, /INTERNAL-NOT-FOR-USERS/);
  assert.match(user.d.getElementById("supportDetail").textContent, /已解决/);
  click(user, "logoutButton"); assert.equal(user.d.getElementById("supportInbox").textContent, ""); assert.equal(user.d.querySelector(".support-lightbox").open, false); assert.ok(user.removed.length > 0);
  assert.deepEqual(compose.errors, []); assert.deepEqual(user.errors, []); assert.deepEqual(admin.errors, []);
});

test("FAQ home links keep both the selected language and a GitHub Pages repository subpath", () => {
  for (const [locale, home] of [["cn", "index-cn.html"], ["en", "index-en.html"]]) {
    const dom = new JSDOM(read(`faq-${locale}.html`), {url: `https://guotao7021.github.io/Scorpio-Intelligence/faq-${locale}.html`});
    const link = dom.window.document.querySelector(".support-home"); assert.ok(link); assert.equal(link.href, `https://guotao7021.github.io/Scorpio-Intelligence/${home}`); dom.window.close();
  }
  assert.match(read("feedback-admin-redirect.js"), /#feedback/);
});

test("account, admin, feedback and FAQ pages reference existing local scripts, styles and images", () => {
  for (const file of ["account.html", "scorpio_v1_admin.html", "feedback-cn.html", "feedback-en.html", "faq-cn.html", "faq-en.html"]) {
    const dom = new JSDOM(read(file));
    for (const element of dom.window.document.querySelectorAll("script[src],link[href],img[src]")) {
      const value = element.getAttribute("src") || element.getAttribute("href");
      if (/^[a-z]+:/i.test(value) || value.startsWith("/")) continue;
      const relative = value.split(/[?#]/)[0];
      assert.ok(existsSync(new URL(relative, publicRoot)), `${file}: missing ${relative}`);
    }
    dom.window.close();
  }
});

test("English feedback keeps its content and screenshot on upload failure and never serializes image bytes into a text draft", async (t) => {
  const f = setup(t); delete f.env.FEEDBACK_BUCKET;
  const auth = {access_token: f.jwt(), email: "researcher@example.test", user_id: 1};
  const ui = page(t, f, "feedback-en.html", feedbackScripts, {auth, lang: "en"});
  await until(() => !ui.d.getElementById("feedbackEmailVerification").hidden, "feedback protection loaded");
  set(ui, "fb-title", "Image retention test"); click(ui, "feedbackNext");
  for (const id of ["description", "steps", "expected", "actual"]) set(ui, `fb-${id}`, `Test ${id}`);
  const event = new ui.w.Event("paste", {bubbles: true, cancelable: true});
  Object.defineProperty(event, "clipboardData", {value: {files: [new File([PNG], "test.png", {type: "image/png"})]}}); ui.d.getElementById("feedbackForm").dispatchEvent(event);
  await until(() => ui.d.querySelector("#feedbackImagePreviews img"), "selected image displayed");
  click(ui, "feedbackSaveDraft");
  const draft = ui.w.sessionStorage.getItem("scorpio_feedback_draft_v2"); assert.doesNotMatch(draft, /data:|blob:|iVBOR|test\.png/);
  assert.match(ui.d.getElementById("feedbackMessage").textContent, /Screenshots are retained only/);
  click(ui, "feedbackNext"); issueCode(f); set(ui, "fb-feedback_verification_code", "123456"); submit(ui, "feedbackForm");
  await until(() => ui.d.getElementById("feedbackMessage").textContent.includes("storage is not ready"), "storage error displayed in English");
  assert.equal(ui.d.getElementById("fb-title").value, "Image retention test"); assert.equal(ui.w.ScorpioFeedbackUploads.files().length, 1);
  assert.equal(ui.d.getElementById("feedbackSubmit").disabled, false); assert.equal(ui.d.getElementById("feedbackReceipt").hidden, true); assert.deepEqual(ui.errors, []);
});

test("the operations workspace creates a customer, issues codes and validates, publishes and unpublishes a package through real routes", async (t) => {
  const f = setup(t); f.env.RELEASE_BUCKET = {head: async (key) => key === "releases/windows/Setup.exe" ? {size: 120000, etag: "fixture-etag"} : null};
  const ui = page(t, f, "scorpio_v1_admin.html", adminScripts, {admin: true});
  await until(() => !ui.d.getElementById("adminConsole").classList.contains("hidden"), "admin authenticated");
  ui.d.querySelector('[data-account-admin-view="legacy"]').click(); click(ui, "deliveryCreate");
  assert.equal(ui.d.getElementById("deliveryEditor-customer").open, true);
  const customer = ui.d.getElementById("customerForm"); customer.elements.customer_name.value = "Delivery QA"; customer.elements.customer_email.value = "newuser@example.test";
  submit(ui, "customerForm"); await until(() => !ui.d.getElementById("deliveryEditor-customer").open, "customer saved and editor closed");
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM customers WHERE customer_name='Delivery QA'").get().n, 1);
  await until(() => ui.d.querySelector("[data-deliver-customer]"), "customer delivery action available"); ui.d.querySelector("[data-deliver-customer]").click();
  assert.equal(ui.d.getElementById("codeForm").elements.email.value, "newuser@example.test"); submit(ui, "codeForm");
  await until(() => ui.d.getElementById("generatedCodes").querySelector("code"), "generated code receipt displayed");
  ui.d.getElementById("deliveryEditor-code").querySelector("[data-delivery-close]").click();
  ui.d.querySelector('[data-delivery-view="releases"]').click(); click(ui, "deliveryCreate");
  const release = ui.d.getElementById("releaseForm"); release.elements.version.value = "9.9.9"; release.elements.r2_key.value = "missing.exe"; release.elements.file_name.value = "Setup.exe";
  submit(ui, "releaseForm"); await until(() => ui.d.getElementById("deliveryEditor-release").textContent.includes("未找到安装包"), "failed package validation visible in the editor");
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM release_versions").get().n, 0); assert.equal(ui.d.getElementById("deliveryEditor-release").open, true);
  release.elements.r2_key.value = "releases/windows/Setup.exe"; submit(ui, "releaseForm");
  await until(() => !ui.d.getElementById("deliveryEditor-release").open, "verified package published");
  assert.equal(f.sql.prepare("SELECT file_size_bytes FROM release_versions WHERE version='9.9.9'").get().file_size_bytes, 120000);
  await until(() => ui.d.querySelector('[data-release-command="detail"]'), "release list shows package actions");
  ui.d.querySelector('[data-release-command="detail"]').click(); assert.match(ui.d.getElementById("deliveryReleaseDetail").textContent, /Setup\.exe/);
  ui.d.getElementById("deliveryEditor-detail").querySelector("[data-delivery-close]").click();
  ui.d.querySelector('[data-release-command="disable"]').click(); submit(ui, "deliveryConfirmForm");
  await until(() => f.sql.prepare("SELECT is_active FROM release_versions WHERE version='9.9.9'").get().is_active === 0, "release unpublished without deleting its row");
  await until(() => !ui.d.getElementById("deliveryEditor-confirm").open && ui.d.querySelector('[data-release-command="disable"]')?.textContent.includes("重新发布"), "republish action available");
  ui.d.querySelector('[data-release-command="disable"]').click(); submit(ui, "deliveryConfirmForm");
  await until(() => f.sql.prepare("SELECT is_active FROM release_versions WHERE version='9.9.9'").get().is_active === 1, "release republished after validation");
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM release_versions").get().n, 1); assert.deepEqual(ui.errors, []);
});

test("registered-user deletion and recovery are visible operations in the same administrator workspace", async (t) => {
  const f = setup(t), ui = page(t, f, "scorpio_v1_admin.html", adminScripts, {admin: true});
  await until(() => ui.d.querySelector('#adminUsersTable [data-record-kind="user"]'), "user cleanup actions loaded");
  ui.d.querySelector('[data-account-admin-view="users"]').click();
  const row = [...ui.d.querySelectorAll("#adminUsersTable tbody tr")].find((item) => item.textContent.includes("expired@example.test"));
  const remove = row.querySelector('[data-record-kind="user"]'); assert.equal(remove.disabled, false); remove.click();
  ui.d.getElementById("portalDialogForm").elements.reason.value = "Expired account cleanup"; submit(ui, "portalDialogForm");
  await until(() => !ui.d.getElementById("portalDialog").open, "account moved to recycle bin");
  set(ui, "adminUserArchive", "1"); ui.d.getElementById("adminUserArchive").dispatchEvent(new ui.w.Event("change"));
  await until(() => ui.d.querySelector('#adminUsersTable [data-record-action="restore"]'), "recycle bin lists archived account");
  ui.d.querySelector('#adminUsersTable [data-record-action="restore"]').click(); ui.d.getElementById("portalDialogForm").elements.reason.value = "Restore account record"; submit(ui, "portalDialogForm");
  await until(() => !ui.d.getElementById("portalDialog").open, "account restored from recycle bin");
  assert.equal(f.sql.prepare("SELECT archived_at FROM users WHERE id=3").get().archived_at, null); assert.deepEqual(ui.errors, []);
});

test("unassigned inventory editing uses a labelled form rather than native prompts", async (t) => {
  const f = setup(t); f.addCode({id: 10, userId: 2, status: "active"});
  f.sql.prepare("UPDATE activation_codes SET assigned_to_user_id=NULL,used_by_user_id=NULL,customer_email='' WHERE id=10").run();
  const ui = page(t, f, "scorpio_v1_admin.html", adminScripts, {admin: true, lang: "en"});
  await until(() => ui.d.querySelector('[data-code-action="edit"][data-code="CODE-10"]'), "inventory loaded");
  ui.d.querySelector('[data-account-admin-view="legacy"]').click(); ui.d.querySelector('[data-delivery-view="codes"]').click();
  ui.d.querySelector('[data-code-action="edit"][data-code="CODE-10"]').click();
  assert.equal(ui.d.getElementById("deliveryEditor-input").open, true);
  const form = ui.d.getElementById("deliveryInputForm"); form.elements.days.value = "45"; form.elements.max_devices.value = "3";
  submit(ui, "deliveryInputForm");
  await until(() => f.sql.prepare("SELECT license_days FROM activation_codes WHERE id=10").get().license_days === 45, "inventory terms saved");
  assert.equal(f.sql.prepare("SELECT max_devices FROM activation_codes WHERE id=10").get().max_devices, 3); assert.deepEqual(ui.errors, []);
});

test("operations overview is the default admin view, switches periods and drills into the existing workflows", async (t) => {
  const f = setup(t), stamp = new Date(Date.now() - 1000).toISOString();
  f.sql.prepare("INSERT INTO site_visit_events(event_id,event_date,page_path,visitor_hash,user_agent_hash,created_at) VALUES('screen-fixture',?,'/','one-visitor','fixture',?)").run(stamp.slice(0, 10), stamp);
  const ui = page(t, f, "scorpio_v1_admin.html", adminScripts, {admin: true});
  await until(() => ui.d.querySelectorAll("[data-ops-day]").length === 7, "default dashboard loaded");
  assert.equal(ui.d.getElementById("adminOverviewView").classList.contains("hidden"), false);
  assert.equal(ui.d.getElementById("opsFullscreen"), null, "the dashboard must stay inside the administration frame");
  assert.equal(ui.d.querySelector('[data-account-admin-view="overview"]').getAttribute("aria-current"), "page");
  ui.d.querySelector('[data-ops-days="30"]').click();
  await until(() => ui.d.querySelectorAll("[data-ops-day]").length === 30, "30-day history loaded");
  ui.d.querySelector("[data-ops-day]").click(); assert.match(ui.d.getElementById("opsSelectedDay").textContent, /PV 0/);
  ui.d.querySelector('[data-ops-go="releases"]').click();
  assert.equal(ui.d.getElementById("adminOverviewView").classList.contains("hidden"), true);
  assert.equal(ui.d.querySelector('[data-delivery-view="releases"]').getAttribute("aria-selected"), "true");
  ui.d.querySelector('[data-account-admin-view="overview"]').click(); ui.d.querySelector('[data-ops-go="requests"]').click();
  assert.equal(ui.d.getElementById("adminRequestsView").classList.contains("hidden"), false); assert.equal(ui.d.getElementById("adminRequestStatus").value, "pending");
  assert.deepEqual(ui.errors, []);
});

test("dashboard refresh errors retain the last successful measurements and logout clears sensitive data", async (t) => {
  const f = setup(t), ui = page(t, f, "scorpio_v1_admin.html", adminScripts, {admin: true, lang: "en"});
  await until(() => ui.d.querySelectorAll("[data-ops-day]").length === 7, "dashboard ready");
  const old = ui.d.querySelector(".ops-kpi-band").innerHTML, original = ui.w.fetch;
  ui.w.fetch = async (url, options) => new URL(url).pathname.endsWith("/operations") ? Response.json({error: "temporary_failure"}, {status: 503}) : original(url, options);
  click(ui, "opsRefresh"); await until(() => ui.d.getElementById("opsNotice").textContent.includes("retained"), "refresh failure marked stale");
  assert.equal(ui.d.querySelector(".ops-kpi-band").innerHTML, old); assert.match(ui.d.getElementById("opsFreshness").textContent, /stale/); assert.equal(ui.d.getElementById("opsApiState").textContent, "Unknown");
  click(ui, "logoutButton"); assert.equal(ui.d.getElementById("opsBody").textContent, ""); assert.deepEqual(ui.errors, []);
});

for (const lang of ["zh-CN", "en"]) test(`partial cloud deployments show actionable errors instead of undefined-property exceptions (${lang})`, async (t) => {
  const f = setup(t), responseOverrides = {};
  for (const path of ["users", "authorizations", "account-requests", "operations"]) responseOverrides[`/v1/scorpio_v1_admin/${path}`] = () => Response.json({error: "not_found"}, {status: 404});
  responseOverrides["/v1/scorpio_v1_admin/feedback"] = () => Response.json({results: [], page: {total: 0, offset: 0, limit: 25, has_more: false}});
  const ui = page(t, f, "scorpio_v1_admin.html", adminScripts, {admin: true, lang, responseOverrides});
  await until(() => ui.d.getElementById("opsNotice").textContent.includes(lang === "en" ? "endpoint is unavailable" : "服务接口不可用"), "missing dashboard API explained");
  await until(() => ui.d.getElementById("supportNotice").textContent.includes(lang === "en" ? "incompatible" : "不兼容"), "legacy feedback schema explained");
  assert.equal(ui.d.getElementById("supportMetrics").classList.contains("hidden"), true);
  assert.match(ui.d.getElementById("supportInbox").textContent, lang === "en" ? /could not be loaded/ : /未加载/);
  ui.d.querySelector('[data-account-admin-view="users"]').click();
  await until(() => ui.d.getElementById("adminAccountNotice").textContent.includes(lang === "en" ? "endpoint is unavailable" : "服务接口不可用"), "missing user API explained");
  assert.doesNotMatch(ui.d.body.textContent, /Cannot read properties|reading 'total'|Existing sign-in and downloads are still available|原有登录和下载仍可使用/);
  delete responseOverrides["/v1/scorpio_v1_admin/feedback"];
  ui.d.querySelector('[data-account-admin-view="feedback"]').click(); click(ui, "supportRefresh");
  await until(() => !ui.d.getElementById("supportMetrics").classList.contains("hidden"), "same session recovers after the API is fixed");
  assert.equal(ui.d.getElementById("supportNotice").classList.contains("hidden"), true);
  assert.deepEqual(ui.errors, []);
});

test("invalid successful dashboard responses retain good data and do not expose JavaScript exceptions", async (t) => {
  const f = setup(t), responseOverrides = {}, ui = page(t, f, "scorpio_v1_admin.html", adminScripts, {admin: true, lang: "en", responseOverrides});
  await until(() => ui.d.querySelectorAll("[data-ops-day]").length === 7, "dashboard ready");
  const old = ui.d.querySelector(".ops-kpi-band").innerHTML;
  responseOverrides["/v1/scorpio_v1_admin/operations"] = () => Response.json({ok: true});
  click(ui, "opsRefresh"); await until(() => ui.d.getElementById("opsNotice").textContent.includes("incompatible"), "incomplete payload rejected");
  assert.equal(ui.d.querySelector(".ops-kpi-band").innerHTML, old);
  assert.equal(ui.d.getElementById("opsApiState").textContent, "Unknown"); assert.deepEqual(ui.errors, []);
});
