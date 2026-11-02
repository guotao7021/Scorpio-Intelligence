import {DatabaseSync} from "node:sqlite";
import {readFileSync, readdirSync} from "node:fs";
import {createHmac, pbkdf2Sync} from "node:crypto";
import worker from "../../src/worker.js";

export const PREVIEW_PASSWORD = "LocalPreview2026!";
export const PREVIEW_ADMIN = "local-preview-admin-only";
export const TEST_JWT_SECRET = "account-center-isolated-test-secret";
export const dayOffset = (days, base = new Date().toISOString().slice(0, 10)) => new Date(Date.parse(`${base}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export function createAccountFixture() {
  const sql = new DatabaseSync(":memory:");
  const directory = new URL("../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((item) => item.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(name, directory), "utf8"));
  const state = {beforeBatch: null};
  function statement(query, args = []) {
    const execute = () => {
      const prepared = sql.prepare(query);
      if (prepared.columns().length) return {results: prepared.all(...args), meta: {changes: 0}};
      const result = prepared.run(...args);
      return {results: [], meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}};
    };
    return {
      bind: (...values) => statement(query, values),
      first: async () => sql.prepare(query).get(...args) || null,
      all: async () => ({results: sql.prepare(query).all(...args)}),
      run: async () => execute(), execute,
    };
  }
  const DB = {
    prepare: statement,
    async batch(queries) {
      const hook = state.beforeBatch; state.beforeBatch = null; hook?.();
      sql.exec("BEGIN");
      try { const result = queries.map((query) => query.execute()); sql.exec("COMMIT"); return result; }
      catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  };
  const env = {DB, JWT_SECRET: TEST_JWT_SECRET, ADMIN_API_TOKEN: PREVIEW_ADMIN,
    STOCK_SIGNING_PRIVATE_KEY: Buffer.alloc(32, 7).toString("base64url"), CORS_ALLOWED_ORIGINS: "*",
    REGISTRATION_TRIAL_DAYS: "7", REGISTRATION_TRIAL_EDITION: "personal_pro",
    MOBILE_MAX_COMPANION_DEVICES: "2", ANALYSIS_RATE_LIMIT_PER_MINUTE: "120",
  };
  const now = new Date().toISOString();
  const salt = Buffer.alloc(16, 3).toString("base64url");
  const passwordHash = `pbkdf2_sha256$100000$${salt}$${pbkdf2Sync(PREVIEW_PASSWORD, Buffer.from(salt, "base64url"), 100000, 32, "sha256").toString("base64url")}`;
  for (const [id, email, username] of [[1, "researcher@example.test", "Research member"], [2, "newuser@example.test", "New member"], [3, "expired@example.test", "Returning member"], [4, "revoked@example.test", "Paused member"]]) {
    sql.prepare("INSERT INTO users(id,email,username,password_hash,email_verified,created_at) VALUES(?,?,?,?,1,?)").run(id, email, username, passwordHash, now);
  }
  function addCode({id, userId = 1, code = `CODE-${id}`, status = "used", edition = "personal_pro", note = "commercial", maxDevices = 2}) {
    sql.prepare("INSERT INTO activation_codes(id,code,edition,license_days,max_devices,status,assigned_to_user_id,notes,created_at) VALUES(?,?,?,365,?,?,?,?,?)")
      .run(id, code, edition, maxDevices, status, userId, note, now);
  }
  function addLicense({id, userId = 1, codeId = 1, licenseId = `LICENSE-${id}`, expires = dayOffset(60), machine = `PC-${id}`, revoked = 0}) {
    const payload = {license_id: licenseId, edition: "personal_pro", machine_fingerprint: machine, expires_at: expires, signature: "fixture-signature", features: {research: true}};
    sql.prepare("INSERT INTO licenses(id,user_id,activation_code_id,license_id,edition,machine_fingerprint,signed_payload,signature,issued_at,expires_at,is_active,revoked,created_at) VALUES(?,?,?,?,'personal_pro',? ,?,'fixture-signature',?,?,?,?,?)")
      .run(id, userId, codeId, licenseId, machine, JSON.stringify(payload), dayOffset(-10), expires, revoked ? 0 : 1, revoked, now);
  }
  addCode({id: 1}); addLicense({id: 1}); addLicense({id: 2});
  addCode({id: 2, note: "auto_registration_trial"}); addLicense({id: 3, codeId: 2, expires: dayOffset(-1)});
  addCode({id: 3, userId: 3}); addLicense({id: 4, userId: 3, codeId: 3, expires: dayOffset(-30)});
  addCode({id: 4, userId: 4}); addLicense({id: 5, userId: 4, codeId: 4, revoked: 1});
  sql.prepare("INSERT INTO mobile_device_bindings(id,user_id,license_id,machine_fingerprint,device_label,created_at,last_seen_at) VALUES(1,1,'LICENSE-1','ANDROID-1','Android phone',?,?)").run(now, now);
  function jwt(userId = 1) {
    const header = Buffer.from(JSON.stringify({alg: "HS256", typ: "JWT"})).toString("base64url");
    const payload = Buffer.from(JSON.stringify({user_id: userId, type: "access", exp: Math.floor(Date.now() / 1000) + 3600})).toString("base64url");
    return `${header}.${payload}.${createHmac("sha256", TEST_JWT_SECRET).update(`${header}.${payload}`).digest("base64url")}`;
  }
  async function request(path, {method = "GET", body, admin = false, userId = 1, anonymous = false, headers: extraHeaders = {}} = {}) {
    const multipart = body instanceof FormData;
    const headers = {...(multipart ? {} : {"content-type": "application/json"}), ...extraHeaders};
    if (admin) headers["x-admin-token"] = PREVIEW_ADMIN;
    else if (!anonymous) headers.authorization = `Bearer ${jwt(userId)}`;
    const response = await worker.fetch(new Request("https://account.example.test/v1" + path, {method, headers, body: body ? multipart ? body : JSON.stringify(body) : undefined}), env);
    const copy = response.clone();
    return {response, status: response.status, data: response.headers.get("content-type")?.includes("application/json") ? await copy.json() : null};
  }
  return {sql, DB, env, state, addCode, addLicense, jwt, request, close: () => sql.close()};
}
