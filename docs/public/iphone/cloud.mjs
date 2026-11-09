const API = "https://api.scorpio-intelligence.tech";
const VERSION = "0.3.0-beta.45";
const SESSION_KEY = "scorpio.iphone.web.session";
const DEVICE_KEY = "scorpio.iphone.web.device";
const editions = { personal_standard: "Standard", personal_pro: "Pro" };
const encoder = new TextEncoder();

export class CloudError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function describeError(error) {
  const messages = {
    auth_challenge_required: "请完成安全验证后登录。",
    auth_challenge_failed: "安全验证已失效，请重新验证后登录。",
    auth_challenge_unavailable: "安全验证服务暂不可用，请稍后重试。",
    email_not_verified: "请先到用户中心验证邮箱，再回来登录。",
    account_entitlement_required: "此账号暂无可用的 Standard 或 Pro 授权。",
    mobile_device_limit_reached: "已达到移动设备数量上限，请到用户中心管理设备。",
    mobile_authorization_required: "移动设备授权已失效，请重新登录。",
    mobile_device_not_authorized: "此浏览器的移动授权已失效，请重新登录。",
    license_expired: "套餐授权已到期，请到用户中心查看。",
    compliance_version_outdated: "使用须知已更新，请重新载入后阅读。",
    invalid_login_response: "登录服务返回的数据暂不可用，请稍后重试。",
    invalid_response: "数据服务返回的格式暂不可用，请稍后重试。",
    storage_unavailable: "此浏览器无法保存设备登记信息。请在 iPhone 的 Safari 中打开后重试。",
  };
  if (!navigator.onLine) return "当前未连接网络。恢复网络后请重试。";
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "连接超时，请重试。";
  return messages[error?.code] || ({
    401: "邮箱或密码有误，或登录已过期。",
    403: "当前账号暂无权限访问此内容。",
    429: "操作过于频繁，请稍后重试。",
  })[error?.status] || "暂时无法连接 Scorpio 服务，请稍后重试。";
}

export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");

async function signature(path, timestamp, nonce, payload, token) {
  const hash = hex(await crypto.subtle.digest("SHA-256", encoder.encode(payload)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(["POST", path, timestamp, nonce, hash].join("\n"))));
}

export async function request(path, fields, token = "") {
  const payload = canonical(fields);
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (token) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID();
    Object.assign(headers, {
      Authorization: "Bearer " + token,
      "X-Scorpio-Timestamp": timestamp,
      "X-Scorpio-Nonce": nonce,
      "X-Scorpio-Signature": await signature(path, timestamp, nonce, payload, token),
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(API + path, { method: "POST", headers, body: payload, cache: "no-store",
      credentials: "omit", redirect: "error", signal: controller.signal });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== "object" || Array.isArray(result) || result.ok === false) {
      throw new CloudError(response.status, result?.error || "invalid_response");
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadAuthSiteKey() {
  const response = await fetch(API + "/v1/auth/security", {
    cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10000),
  });
  const policy = await response.json();
  if (!response.ok || policy?.mode !== "turnstile" || !policy.site_key) {
    throw new CloudError(response.status, "auth_challenge_unavailable");
  }
  return policy.site_key;
}

function deviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const value = "pwa-" + crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, value);
    return value;
  } catch {
    throw new CloudError(0, "storage_unavailable");
  }
}

function tokens(result) {
  if (!Number.isSafeInteger(result.user_id) || result.user_id < 1 ||
      typeof result.access_token !== "string" || !result.access_token ||
      typeof result.refresh_token !== "string" || !result.refresh_token) {
    throw new CloudError(0, "invalid_login_response");
  }
  return { user: result.user_id, access: result.access_token, refresh: result.refresh_token };
}

function authorization(result) {
  if (!Object.hasOwn(editions, result?.edition) || !result.license_id || !(result.valid || result.active)) {
    throw new CloudError(403, "account_entitlement_required");
  }
  return { edition: result.edition, license: result.license_id };
}

export class MobileSession {
  #account = null;
  #generation = 0;
  #refresh = null;

  get edition() { return editions[this.#account?.edition] || ""; }

  #save(account, generation) {
    if (generation !== this.#generation) throw new CloudError(401, "session_changed");
    this.#account = account;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(account)); } catch { /* keep in memory */ }
  }

  logout() {
    this.#generation++;
    this.#account = null;
    this.#refresh = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* memory was cleared */ }
  }

  async login(email, password, challengeToken) {
    this.logout();
    const generation = this.#generation;
    const fingerprint = deviceId();
    const credentials = tokens(await request("/v1/auth/login", {
      email, password, auth_context: "browser", turnstile_token: challengeToken,
    }));
    const license = authorization(await request("/v1/mobile/authorize", {
      machine_fingerprint: fingerprint, client_version: VERSION, device_platform: "ios",
      device_label: "iPhone 网页版", entitlement_mode: "highest",
    }, credentials.access));
    this.#save({ ...credentials, ...license, fingerprint }, generation);
    return this.bootstrap();
  }

  async restore() {
    let value;
    try { value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
    if (!value || !Number.isSafeInteger(value.user) || !value.access || !value.refresh ||
        !value.license || !Object.hasOwn(editions, value.edition) || value.fingerprint !== deviceId()) return null;
    this.#account = value;
    return this.bootstrap();
  }

  async bootstrap() {
    const result = await this.read("/v1/mobile/bootstrap", { bootstrap_scope: "home", startup_version: 1 });
    if (result.session?.user_id !== this.#account?.user || result.source?.demo !== false ||
        !result.home || typeof result.compliance?.required !== "boolean") {
      throw new CloudError(0, "invalid_response");
    }
    const license = authorization(result.license);
    this.#save({ ...this.#account, ...license }, this.#generation);
    return result;
  }

  async read(path, data = {}) {
    const account = this.#account;
    const generation = this.#generation;
    if (!account) throw new CloudError(401, "session_changed");
    const send = a => request(path, {
      market: "CN", positions: [], portfolio_api_version: 2, compliance_format_version: 2, ...data,
      license_id: a.license, machine_fingerprint: a.fingerprint, client_version: VERSION,
    }, a.access);
    let result;
    try {
      result = await send(account);
    } catch (error) {
      if (error.status !== 401 || generation !== this.#generation) throw error;
      if (this.#account.access === account.access && !this.#refresh) {
        const renewal = request("/v1/auth/refresh", { refresh_token: account.refresh }).then(value => {
          const updated = tokens(value);
          if (updated.user !== account.user) throw new CloudError(401, "session_changed");
          this.#save({ ...account, ...updated }, generation);
        }).finally(() => { if (this.#refresh === renewal) this.#refresh = null; });
        this.#refresh = renewal;
      }
      await this.#refresh;
      if (generation !== this.#generation) throw new CloudError(401, "session_changed");
      result = await send(this.#account);
    }
    if (generation !== this.#generation) throw new CloudError(401, "session_changed");
    return result;
  }
}
