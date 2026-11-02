import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import worker from "../src/worker.js";

const JWT_SECRET = "account-license-contract-secret";

test("current license filters by edition and returns the old binding for desktop rebind", async () => {
  const db = fakeDb();
  const response = await worker.fetch(
    authenticatedGet("/v1/license/current?machine_fingerprint=DEVICE-NEW&edition=personal_pro"),
    env(db),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.message, "machine_fingerprint_mismatch");
  assert.equal(payload.license_id, "LIC-PRO-001");
  assert.equal(payload.machine_fingerprint, "DEVICE-OLD");
  assert.equal(payload.activation_code, "PRO-CODE");
  assert.deepEqual(db.currentLicenseBindings, [7, "personal_pro", "DEVICE-NEW", "DEVICE-NEW"]);
});

test("current license response prefers the activation code matching the requested edition", async () => {
  const db = fakeDb();
  const response = await worker.fetch(
    authenticatedGet("/v1/license/current?machine_fingerprint=DEVICE-NEW&edition=personal_standard"),
    env(db),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.active, false);
  assert.equal(payload.message, "activation_code_assigned");
  assert.equal(payload.activation_code, "STANDARD-CODE");
  assert.equal(payload.activation_edition, "personal_standard");
});

function env(DB) {
  return {
    DB,
    JWT_SECRET,
    CORS_ALLOWED_ORIGINS: "*",
  };
}

function fakeDb() {
  const state = {
    currentLicenseBindings: [],
    prepare(sql) {
      const statement = {
        bindings: [],
        bind(...values) {
          this.bindings = values;
          return this;
        },
        async first() {
          if (sql.includes("SELECT * FROM users WHERE id")) {
            return { id: Number(this.bindings[0]), email: "customer@example.test", email_verified: 1 };
          }
          if (sql.includes("FROM licenses") && sql.includes("ORDER BY CASE")) {
            state.currentLicenseBindings = [...this.bindings];
            if (this.bindings.includes("personal_standard")) return null;
            return {
              id: 31,
              user_id: 7,
              license_id: "LIC-PRO-001",
              edition: "personal_pro",
              machine_fingerprint: "DEVICE-OLD",
              signed_payload: JSON.stringify({
                license_id: "LIC-PRO-001",
                edition: "personal_pro",
                machine_fingerprint: "DEVICE-OLD",
                signature: "contract-signature",
              }),
              expires_at: "2099-12-31",
              is_active: 1,
              revoked: 0,
              created_at: "2026-09-18T00:00:00Z",
            };
          }
          return null;
        },
        async all() {
          if (!sql.includes("FROM activation_codes ac")) return { results: [] };
          return {
            results: [
              {
                code: "PRO-CODE",
                edition: "personal_pro",
                license_days: 365,
                status: "active",
                created_at: "2026-09-18T00:00:00Z",
                license_id: "LIC-PRO-001",
                expires_at: "2099-12-31",
                license_active: 1,
                license_revoked: 0,
                approval_status: "auto",
                machine_fingerprint: "DEVICE-OLD",
              },
              {
                code: "STANDARD-CODE",
                edition: "personal_standard",
                license_days: 365,
                status: "assigned",
                created_at: "2026-09-17T00:00:00Z",
                license_id: "",
                expires_at: "",
                license_active: 0,
                license_revoked: 0,
                approval_status: "",
                machine_fingerprint: "",
              },
            ],
          };
        },
      };
      return statement;
    },
  };
  return state;
}

function authenticatedGet(path) {
  return new Request(`https://api.example.invalid${path}`, {
    headers: { authorization: `Bearer ${accessToken(7, "customer@example.test")}` },
  });
}

function accessToken(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ user_id: userId, email, type: "access", iat: now, exp: now + 3600 }));
  const material = `${header}.${payload}`;
  const signature = createHmac("sha256", JWT_SECRET).update(material).digest("base64url");
  return `${material}.${signature}`;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}
