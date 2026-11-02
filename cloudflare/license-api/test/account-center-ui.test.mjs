import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source = new URL("../../../docs/public/", import.meta.url);
function views(lang = "zh-CN") {
  const context = vm.createContext({window: {}, document: {documentElement: {lang}, addEventListener() {}}, Intl, Date, Map});
  vm.runInContext(readFileSync(new URL("account-center-ui.js", source), "utf8"), context);
  return context.window.ScorpioAccountViews;
}

test("user-center and administration scripts remain valid classic browser scripts", () => {
  for (const file of ["account.js", "account-i18n.js", "account-center-ui.js", "admin-accounts.js", "scorpio_v1_admin.js", "feedback.js", "feedback-center-ui.js"]) {
    assert.doesNotThrow(() => new vm.Script(readFileSync(new URL(file, source), "utf8"), {filename: file}));
  }
});

test("license cards group device credentials and prefer the valid grant with the latest expiry", () => {
  const V = views();
  const items = V.groupLicenses([
    {license_id: "A", activation_code: "SAME", status: "revoked", expires_at: "2030-01-01"},
    {license_id: "B", activation_code: "SAME", status: "active", expires_at: "2026-11-03"},
    {license_id: "C", activation_code: "SAME", status: "active", expires_at: "2026-12-03"},
    {license_id: "D", activation_code: "", status: "active"},
    {license_id: "E", activation_code: "", status: "active"},
  ]);
  assert.equal(items.length, 3); assert.equal(items[0].license_id, "C"); assert.equal(items[0].license_ids.length, 3);
});

test("timeline deduplicates by operation before limiting, escapes text and translates its events", () => {
  const input = [
    {id: 3, operation_id: "OP-2", action: "extend", reason: "<script>bad</script>", before: {}, after: {}},
    {id: 2, operation_id: "OP-2", action: "extend", before: {}, after: {}},
    {id: 1, operation_id: "OP-1", action: "code_suspend", before: {}, after: {}},
  ];
  const V = views("en");
  const output = V.eventList(input, 2);
  assert.equal((output.match(/class="portal-event"/g) || []).length, 2);
  assert.match(output, /License extended/); assert.match(output, /Activation paused/);
  assert.doesNotMatch(output, /<script>/); assert.match(output, /&lt;script&gt;/);
  assert.equal((V.eventList(input, 1).match(/class="portal-event"/g) || []).length, 1);
});

test("date previews preserve remaining validity and use the server day for expired grants", () => {
  const V = views();
  assert.equal(V.expiry("2026-12-01", 30, "2026-11-02T00:00:00Z"), "2026-12-31");
  assert.equal(V.expiry("2026-10-01", 30, "2026-11-02T00:00:00Z"), "2026-12-02");
});

test("revoked and pending cards expose only the appropriate state transition commands", () => {
  const V = views("en");
  const row = {license_id: "A", edition: "personal_pro", kind: "commercial", expires_at: "2026-12-01", max_devices: 1, days_left: 30};
  const revoked = V.licenseCard({...row, status: "revoked"}, true);
  assert.match(revoked, /data-license-command="restore"/); assert.doesNotMatch(revoked, /data-license-command="extend"/);
  const pending = V.licenseCard({...row, status: "pending"}, true);
  assert.match(pending, /data-license-command="approve"/); assert.doesNotMatch(pending, /data-download-license/);
});
