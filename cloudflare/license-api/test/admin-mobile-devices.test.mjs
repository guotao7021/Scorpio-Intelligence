import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.js";

test("admin can revoke all active mobile bindings without changing the commercial license", async () => {
  const db = fakeDb();
  const response = await worker.fetch(
    new Request("https://api.example.invalid/v1/scorpio_v1_admin/mobile-devices/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": "admin-contract-token",
      },
      body: JSON.stringify({ user_id: 4, email: "owner@example.invalid" }),
    }),
    {
      DB: db,
      ADMIN_API_TOKEN: "admin-contract-token",
      ADMIN_API_TOKEN_ID: "test-admin",
      CORS_ALLOWED_ORIGINS: "*",
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.revoked_devices, 2);
  assert.equal(payload.active_mobile_devices, 0);
  assert.equal(db.activeMobileDevices, 0);
  assert.equal(db.licenseTouched, false);
  assert.equal(db.resetAuditLogged, true);
});

test("admin mobile reset rejects an account identity mismatch", async () => {
  const db = fakeDb();
  const response = await worker.fetch(
    new Request("https://api.example.invalid/v1/scorpio_v1_admin/mobile-devices/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": "admin-contract-token",
      },
      body: JSON.stringify({ user_id: 4, email: "different@example.invalid" }),
    }),
    {
      DB: db,
      ADMIN_API_TOKEN: "admin-contract-token",
      CORS_ALLOWED_ORIGINS: "*",
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "mobile_device_account_mismatch" });
  assert.equal(db.activeMobileDevices, 2);
});

function fakeDb() {
  return {
    activeMobileDevices: 2,
    licenseTouched: false,
    resetAuditLogged: false,
    prepare(sql) {
      let bindings = [];
      const db = this;
      return {
        bind(...values) {
          bindings = values;
          return this;
        },
        async first() {
          if (sql.includes("SELECT id, email FROM users WHERE id")) {
            return Number(bindings[0]) === 4 ? { id: 4, email: "owner@example.invalid" } : null;
          }
          return null;
        },
        async run() {
          if (sql.includes("UPDATE mobile_device_bindings")) {
            const changes = db.activeMobileDevices;
            db.activeMobileDevices = 0;
            return { success: true, meta: { changes } };
          }
          if (sql.includes("UPDATE licenses") || sql.includes("DELETE FROM licenses")) {
            db.licenseTouched = true;
          }
          if (sql.includes("INSERT INTO admin_audit_events") && bindings[0] === "mobile_devices_reset") {
            db.resetAuditLogged = true;
          }
          return { success: true, meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
      };
    },
  };
}
