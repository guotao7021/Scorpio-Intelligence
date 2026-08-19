import assert from "node:assert/strict";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import test from "node:test";

import worker from "../src/worker.js";

const JWT_SECRET = "mobile-authorize-contract-secret";

test("mobile login authenticates and authorizes the device in one request", async () => {
  const db = fakeDb({ hasLicense: true, loginPassword: "correct-password" });
  const response = await worker.fetch(
    new Request("https://api.example.invalid/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "mobile-test@example.invalid",
        password: "correct-password",
        machine_fingerprint: "android-combined-login-device",
        client_version: "0.2.0",
        device_label: "Android",
      }),
    }),
    env(db),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.mobile_license.valid, true);
  assert.equal(payload.mobile_license.license_id, "LIC-PRO-CONTRACT");
  assert.equal(db.insertedBinding, true);
});

test("mobile authorize binds an account entitlement without activation code", async () => {
  const db = fakeDb({ hasLicense: true });
  const token = accessToken(7, "mobile-test@example.invalid");
  const body = {
    machine_fingerprint: "android-contract-device",
    client_version: "0.1.0",
    device_label: "Android",
  };
  const request = signedRequest("/v1/mobile/authorize", token, body);

  const response = await worker.fetch(request, env(db));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.active, true);
  assert.equal(payload.valid, true);
  assert.equal(payload.license_id, "LIC-PRO-CONTRACT");
  assert.equal(payload.message, "mobile_device_authorized");
  assert.equal(payload.mobile_device.companion, true);
  assert.equal("activation_code" in payload, false);
  assert.equal(db.insertedBinding, true);
});

test("mobile authorize uses the activation-code device entitlement instead of the global fallback", async () => {
  const db = fakeDb({ hasLicense: true, activeMobileDevices: 2, activationMaxDevices: 9999 });
  const token = accessToken(7, "mobile-test@example.invalid");
  const response = await worker.fetch(
    signedRequest("/v1/mobile/authorize", token, {
      machine_fingerprint: "android-third-test-device",
      client_version: "0.2.1",
      device_label: "Android",
    }),
    env(db),
  );

  assert.equal(response.status, 200);
  assert.equal(db.insertedBinding, true);
});

test("mobile authorize still rejects a new device at the activation-code device limit", async () => {
  const db = fakeDb({ hasLicense: true, activeMobileDevices: 2, activationMaxDevices: 2 });
  const token = accessToken(7, "mobile-test@example.invalid");
  const response = await worker.fetch(
    signedRequest("/v1/mobile/authorize", token, {
      machine_fingerprint: "android-over-limit-device",
      client_version: "0.2.1",
      device_label: "Android",
    }),
    env(db),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "mobile_device_limit_reached" });
  assert.equal(db.insertedBinding, false);
});

test("mobile authorize rejects an account without commercial entitlement", async () => {
  const db = fakeDb({ hasLicense: false });
  const token = accessToken(8, "unlicensed@example.invalid");
  const response = await worker.fetch(
    signedRequest("/v1/mobile/authorize", token, {
      machine_fingerprint: "android-unlicensed-device",
      client_version: "0.1.0",
      device_label: "Android",
    }),
    env(db),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "account_entitlement_required" });
});

test("mobile authorize redeems the newest assigned entitlement and preserves the desktop binding", async () => {
  const db = fakeDb({ hasLicense: false, hasAssignedEntitlement: true });
  const token = accessToken(9, "renewed@example.invalid");
  const response = await worker.fetch(
    signedRequest("/v1/mobile/authorize", token, {
      machine_fingerprint: "android-renewed-device",
      client_version: "0.1.0",
      device_label: "Android",
    }),
    env(db),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.license_id, "LIC-EXPIRED-DESKTOP");
  assert.equal(payload.edition, "personal_pro");
  assert.equal(payload.mobile_device.companion, true);
  assert.equal("activation_code" in payload, false);
  assert.equal(db.redeemedEntitlement, true);
  assert.equal(db.preservedMachineFingerprint, "desktop-contract-device");
  assert.equal(db.insertedBinding, true);
});

test("mobile authorize creates an account license when assigned entitlement has no license history", async () => {
  const db = fakeDb({ hasLicense: false, hasAssignedEntitlement: true, hasPreviousLicense: false });
  const token = accessToken(10, "new-mobile@example.invalid");
  const response = await worker.fetch(
    signedRequest("/v1/mobile/authorize", token, {
      machine_fingerprint: "android-new-account-device",
      client_version: "0.1.0",
      device_label: "Android",
    }),
    env(db),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(payload.license_id, /^LIC-PERSONAL-PRO-/);
  assert.equal(db.redeemedEntitlement, true);
  assert.equal(db.preservedMachineFingerprint, "");
  assert.equal(db.insertedBinding, true);
});

test("mobile authorize requires login", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.invalid/v1/mobile/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ machine_fingerprint: "android-anonymous" }),
    }),
    env(fakeDb({ hasLicense: true })),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
});

function env(DB) {
  return {
    DB,
    JWT_SECRET,
    ANALYSIS_REQUIRE_REQUEST_SIGNATURE: "1",
    ANALYSIS_RATE_LIMIT_PER_MINUTE: "120",
    ANALYSIS_REPLAY_WINDOW_SECONDS: "300",
    MOBILE_MAX_COMPANION_DEVICES: "2",
    LICENSE_AUTO_ISSUE_EDITIONS: "personal_standard,personal_pro",
    STOCK_SIGNING_PRIVATE_KEY: Buffer.alloc(32, 7).toString("base64url"),
    CORS_ALLOWED_ORIGINS: "*",
  };
}

function fakeDb({
  hasLicense,
  hasAssignedEntitlement = false,
  hasPreviousLicense = true,
  loginPassword = "",
  activeMobileDevices = 0,
  activationMaxDevices,
}) {
  const state = {
    insertedBinding: false,
    redeemedEntitlement: false,
    preservedMachineFingerprint: "",
    redeemedLicenseId: "",
    prepare(sql) {
      let bindings = [];
      return {
        bind(...values) {
          bindings = values;
          return this;
        },
        async first() {
          if (sql.includes("INSERT INTO api_rate_limits")) return { request_count: 1 };
          if (sql.includes("SELECT * FROM users WHERE email")) {
            return {
              id: 7,
              email: "mobile-test@example.invalid",
              email_verified: 1,
              password_hash: passwordHash(loginPassword),
            };
          }
          if (sql.includes("SELECT * FROM users WHERE id")) {
            return { id: Number(bindings[0]), email: "mobile-test@example.invalid", email_verified: 1 };
          }
          if (sql.includes("SELECT count FROM analysis_rate_limits")) return { count: 1 };
          if (sql.includes("FROM mobile_device_bindings b") && sql.includes("ORDER BY b.id DESC")) return null;
          if (sql.includes("SELECT * FROM licenses") && sql.includes("approval_status")) {
            if (!hasLicense && !state.redeemedEntitlement) return null;
            return {
              id: 20,
              user_id: Number(bindings[0]),
              activation_code_id: activationMaxDevices === undefined ? null : 14,
              license_id: "LIC-PRO-CONTRACT",
              edition: "personal_pro",
              machine_fingerprint: "desktop-device",
              signed_payload: JSON.stringify({ customer_name: "Contract User", features: { mobile: true } }),
              expires_at: "2099-12-31",
              is_active: 1,
              revoked: 0,
              approval_status: "auto",
              created_at: "2026-08-17T00:00:00Z",
            };
          }
          if (sql.includes("SELECT max_devices FROM activation_codes WHERE id")) {
            return activationMaxDevices === undefined ? null : { max_devices: activationMaxDevices };
          }
          if (sql.includes("SELECT * FROM activation_codes") && sql.includes("assigned_to_user_id")) {
            if (!hasAssignedEntitlement) return null;
            return {
              id: 31,
              assigned_to_user_id: Number(bindings[0]),
              edition: "personal_pro",
              license_days: 365,
              max_devices: 2,
              status: "assigned",
              customer_email: "renewed@example.invalid",
              machine_fingerprint_prebind: "",
              created_at: "2026-08-17T01:37:18Z",
            };
          }
          if (sql.includes("SELECT * FROM licenses") && sql.includes("WHERE user_id = ? AND edition = ?")) {
            if (!hasPreviousLicense) return null;
            return {
              id: 22,
              user_id: Number(bindings[0]),
              license_id: "LIC-EXPIRED-DESKTOP",
              edition: "personal_pro",
              machine_fingerprint: "desktop-contract-device",
              signed_payload: JSON.stringify({ customer_name: "Renewed User", features: { mobile: true } }),
              expires_at: "2026-07-24",
              is_active: 1,
              revoked: 0,
              approval_status: "auto",
              created_at: "2026-06-24T00:00:00Z",
            };
          }
          if (sql.includes("WHERE user_id = ? AND license_id = ?") && state.redeemedEntitlement) {
            return {
              id: 22,
              user_id: Number(bindings[0]),
              license_id: state.redeemedLicenseId,
              edition: "personal_pro",
              machine_fingerprint: state.preservedMachineFingerprint,
              signed_payload: JSON.stringify({ customer_name: "Renewed User", features: { mobile: true } }),
              expires_at: "2099-12-31",
              is_active: 1,
              revoked: 0,
              approval_status: "auto",
              created_at: "2026-06-24T00:00:00Z",
            };
          }
          if (sql.includes("COUNT(*) AS total FROM mobile_device_bindings")) return { total: activeMobileDevices };
          return null;
        },
        async run() {
          if (sql.includes("UPDATE licenses") && sql.includes("activation_code_id")) {
            state.redeemedEntitlement = true;
            state.preservedMachineFingerprint = String(bindings[2] || "");
            state.redeemedLicenseId = "LIC-EXPIRED-DESKTOP";
          }
          if (sql.includes("INSERT INTO licenses") && sql.includes("activation_code_id")) {
            state.redeemedEntitlement = true;
            state.preservedMachineFingerprint = String(bindings[3] || "");
            state.redeemedLicenseId = String(bindings[1] || "");
          }
          if (sql.includes("INSERT INTO mobile_device_bindings")) state.insertedBinding = true;
          return { success: true, meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
      };
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return state;
}

function passwordHash(password) {
  const iterations = 100000;
  const salt = Buffer.alloc(16, 4).toString("base64url");
  const expected = pbkdf2Sync(password, Buffer.from(salt, "base64url"), iterations, 32, "sha256").toString("base64url");
  return `pbkdf2_sha256$${iterations}$${salt}$${expected}`;
}

function accessToken(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ user_id: userId, email, type: "access", iat: now, exp: now + 3600 }));
  const material = `${header}.${payload}`;
  const signature = createHmac("sha256", JWT_SECRET).update(material).digest("base64url");
  return `${material}.${signature}`;
}

function signedRequest(path, token, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(18).toString("base64url");
  const bodyHash = createHash("sha256").update(stableJson(body)).digest("hex");
  const base = `POST\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const signature = createHmac("sha256", token).update(base).digest("hex");
  return new Request(`https://api.example.invalid${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-scorpio-timestamp": timestamp,
      "x-scorpio-nonce": nonce,
      "x-scorpio-signature": signature,
    },
    body: JSON.stringify(body),
  });
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}
