(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";
  const TOKEN_KEY = "scorpio_user_auth";

  const state = loadAuth();

  const els = {
    sessionEmail: byId("sessionEmail"),
    sessionHint: byId("sessionHint"),
    authStatus: byId("authStatus"),
    authMessage: byId("authMessage"),
    licenseMessage: byId("licenseMessage"),
    loginForm: byId("loginForm"),
    registerForm: byId("registerForm"),
    resetForm: byId("resetForm"),
    loginEmail: byId("loginEmail"),
    loginPassword: byId("loginPassword"),
    registerEmail: byId("registerEmail"),
    registerName: byId("registerName"),
    registerPassword: byId("registerPassword"),
    registerCode: byId("registerCode"),
    resetEmail: byId("resetEmail"),
    resetCode: byId("resetCode"),
    resetPassword: byId("resetPassword"),
    sendRegisterCode: byId("sendRegisterCode"),
    sendResetCode: byId("sendResetCode"),
    activateForm: byId("activateForm"),
    statusForm: byId("statusForm"),
    activationCode: byId("activationCode"),
    machineFingerprint: byId("machineFingerprint"),
    licenseId: byId("licenseId"),
    releaseVersion: byId("releaseVersion"),
    releaseMeta: byId("releaseMeta"),
    releaseBox: byId("releaseBox"),
    downloadLink: byId("downloadLink"),
    refreshRelease: byId("refreshRelease"),
    logoutButton: byId("logoutButton"),
  };

  init();

  function init() {
    document.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => switchAuthTab(button.dataset.authTab));
    });
    els.loginForm.addEventListener("submit", guard(onLogin, els.authMessage));
    els.registerForm.addEventListener("submit", guard(onRegister, els.authMessage));
    els.resetForm.addEventListener("submit", guard(onResetPassword, els.authMessage));
    els.sendRegisterCode.addEventListener("click", guard(() => sendCode(els.registerEmail.value, "register", els.authMessage), els.authMessage));
    els.sendResetCode.addEventListener("click", guard(() => sendCode(els.resetEmail.value, "reset_password", els.authMessage), els.authMessage));
    els.activateForm.addEventListener("submit", guard(onActivate, els.licenseMessage));
    els.statusForm.addEventListener("submit", guard(onCheckLicense, els.licenseMessage));
    els.refreshRelease.addEventListener("click", refreshRelease);
    els.logoutButton.addEventListener("click", logout);
    renderSession();
    refreshRelease();
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function switchAuthTab(tab) {
    document.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.authTab === tab);
    });
    els.loginForm.classList.toggle("hidden", tab !== "login");
    els.registerForm.classList.toggle("hidden", tab !== "register");
    els.resetForm.classList.toggle("hidden", tab !== "reset");
    setMessage(els.authMessage, "", "");
  }

  function guard(handler, messageTarget) {
    return async function (event) {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      try {
        await handler(event);
      } catch (error) {
        setMessage(messageTarget, error.message || String(error), "error");
      }
    };
  }

  async function onLogin(event) {
    event.preventDefault();
    setMessage(els.authMessage, "正在登录...", "loading");
    const data = await request("/auth/login", {
      method: "POST",
      body: {
        email: els.loginEmail.value.trim(),
        password: els.loginPassword.value,
      },
      auth: false,
    });
    state.access_token = data.access_token;
    state.refresh_token = data.refresh_token;
    state.email = data.email;
    state.user_id = data.user_id;
    saveAuth();
    renderSession();
    setMessage(els.authMessage, "登录成功。现在可以激活授权或回到桌面端同步数据。", "success");
  }

  async function onRegister(event) {
    event.preventDefault();
    setMessage(els.authMessage, "正在注册...", "loading");
    await request("/auth/register", {
      method: "POST",
      body: {
        email: els.registerEmail.value.trim(),
        username: els.registerName.value.trim(),
        password: els.registerPassword.value,
        verification_code: els.registerCode.value.trim(),
      },
      auth: false,
    });
    els.loginEmail.value = els.registerEmail.value.trim();
    switchAuthTab("login");
    setMessage(els.authMessage, "注册成功。请使用刚才的邮箱和密码登录。", "success");
  }

  async function onResetPassword(event) {
    event.preventDefault();
    setMessage(els.authMessage, "正在重置密码...", "loading");
    await request("/auth/reset-password", {
      method: "POST",
      body: {
        email: els.resetEmail.value.trim(),
        verification_code: els.resetCode.value.trim(),
        new_password: els.resetPassword.value,
      },
      auth: false,
    });
    els.loginEmail.value = els.resetEmail.value.trim();
    switchAuthTab("login");
    setMessage(els.authMessage, "密码已重置。请重新登录。", "success");
  }

  async function sendCode(email, purpose, target) {
    if (!email.trim()) {
      setMessage(target, "请先填写邮箱。", "warn");
      return;
    }
    setMessage(target, "正在发送验证码...", "loading");
    const data = await request("/auth/send-code", {
      method: "POST",
      body: { email: email.trim(), purpose },
      auth: false,
    });
    const debug = data.debug_code ? ` 调试码：${data.debug_code}` : "";
    setMessage(target, `验证码已发送，请查看邮箱。${debug}`, "success");
  }

  async function onActivate(event) {
    event.preventDefault();
    requireLogin();
    setMessage(els.licenseMessage, "正在激活授权...", "loading");
    const data = await request("/license/activate", {
      method: "POST",
      body: {
        activation_code: els.activationCode.value.trim(),
        machine_fingerprint: els.machineFingerprint.value.trim(),
        client_version: "web-account",
      },
      auth: true,
    });
    els.licenseId.value = data.license_id || "";
    setMessage(
      els.licenseMessage,
      `授权已激活：${data.edition || ""}，有效期至 ${data.expires_at || "待确认"}。`,
      "success"
    );
  }

  async function onCheckLicense(event) {
    event.preventDefault();
    requireLogin();
    setMessage(els.licenseMessage, "正在检查授权状态...", "loading");
    const data = await request("/license/status", {
      method: "POST",
      body: {
        license_id: els.licenseId.value.trim(),
        machine_fingerprint: els.machineFingerprint.value.trim(),
        client_version: "web-account",
      },
      auth: true,
    });
    const type = data.valid ? "success" : "warn";
    setMessage(els.licenseMessage, data.valid ? "授权有效，可以回到桌面端同步数据。" : `授权不可用：${data.message || data.reason || "unknown"}`, type);
  }

  async function refreshRelease() {
    els.releaseBox.classList.add("loading");
    els.releaseVersion.textContent = "正在读取...";
    els.releaseMeta.textContent = "连接 Cloudflare API 获取最新发行信息。";
    try {
      const data = await request("/releases/latest?edition=personal_pro&channel=stable", { method: "GET", auth: false });
      els.releaseVersion.textContent = data.version || data.latest_version || "--";
      els.releaseMeta.textContent = data.release_notes || `发布时间：${data.release_date || "未提供"}`;
      if (data.download_url) {
        els.downloadLink.href = data.download_url;
        els.downloadLink.classList.remove("disabled");
        els.downloadLink.removeAttribute("aria-disabled");
      } else {
        els.downloadLink.href = "#";
        els.downloadLink.classList.add("disabled");
        els.downloadLink.setAttribute("aria-disabled", "true");
      }
    } catch (error) {
      els.releaseVersion.textContent = "暂不可用";
      els.releaseMeta.textContent = error.message || "发行信息读取失败。";
    } finally {
      els.releaseBox.classList.remove("loading");
    }
  }

  async function request(path, options) {
    const headers = { "content-type": "application/json" };
    if (options.auth) {
      requireLogin();
      headers.authorization = `Bearer ${state.access_token}`;
    }
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (response.status === 401 && options.auth && state.refresh_token) {
      const refreshed = await refreshToken();
      if (refreshed) {
        return request(path, options);
      }
    }
    if (!response.ok) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }
    return data;
  }

  async function refreshToken() {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: state.refresh_token }),
      });
      const data = await response.json();
      if (!response.ok) {
        return false;
      }
      state.access_token = data.access_token;
      state.refresh_token = data.refresh_token;
      state.email = data.email;
      state.user_id = data.user_id;
      saveAuth();
      renderSession();
      return true;
    } catch {
      return false;
    }
  }

  function requireLogin() {
    if (!state.access_token) {
      throw new Error("请先登录用户中心。");
    }
  }

  function renderSession() {
    const loggedIn = Boolean(state.access_token);
    els.sessionEmail.textContent = state.email || "未登录";
    els.sessionHint.textContent = loggedIn
      ? "已登录。桌面端需要使用同一账号，并绑定有效 License ID 与机器码。"
      : "登录后可激活授权、检查发行包，并让桌面端使用同一账号同步云端数据。";
    els.authStatus.textContent = loggedIn ? "已登录" : "未登录";
    els.logoutButton.disabled = !loggedIn;
  }

  function logout() {
    state.access_token = "";
    state.refresh_token = "";
    state.email = "";
    state.user_id = "";
    saveAuth();
    renderSession();
    setMessage(els.authMessage, "已退出登录。", "success");
  }

  function loadAuth() {
    try {
      return JSON.parse(localStorage.getItem(TOKEN_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveAuth() {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(state));
  }

  function setMessage(el, text, type) {
    el.textContent = text;
    el.className = `account-message ${type || ""}`.trim();
  }

  function byId(id) {
    return document.getElementById(id);
  }
})();
