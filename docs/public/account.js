(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";
  const TOKEN_KEY = "scorpio_user_auth";
  const LICENSE_KEY = "scorpio_user_license";
  const RELEASE_CHANNEL = "stable";
  const RELEASE_EDITION_PRIORITY = ["personal_pro", "personal_standard"];

  const state = loadAuth();
  const licenseState = loadLicenseState();

  const els = {
    sessionEmail: byId("sessionEmail"),
    sessionHint: byId("sessionHint"),
    authStatus: byId("authStatus"),
    nextStepText: byId("nextStepText"),
    licenseState: byId("licenseState"),
    licenseChip: byId("licenseChip"),
    releaseState: byId("releaseState"),
    syncState: byId("syncState"),
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
    downloadProgress: byId("downloadProgress"),
    downloadProgressText: byId("downloadProgressText"),
    downloadProgressPercent: byId("downloadProgressPercent"),
    downloadProgressBar: byId("downloadProgressBar"),
    downloadProgressMeta: byId("downloadProgressMeta"),
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
    els.downloadLink.addEventListener("click", guard(downloadRelease, els.authMessage));
    els.logoutButton.addEventListener("click", logout);
    renderSession();
    refreshAccountData();
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
    applyActivationCodePayload(data);
    await refreshAccountData();
    setMessage(els.authMessage, "登录成功。现在可以激活授权，或回到桌面端同步数据。", "success");
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
    setMessage(els.authMessage, "密码已重置，请重新登录。", "success");
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
    const activationCode = els.activationCode.value.trim();
    const machineFingerprint = els.machineFingerprint.value.trim();
    setLicenseStatus("激活中", "正在激活");
    setMessage(els.licenseMessage, "正在激活授权...", "loading");
    const data = await request("/license/activate", {
      method: "POST",
      body: {
        activation_code: activationCode,
        machine_fingerprint: machineFingerprint,
        client_version: "web-account",
      },
      auth: true,
    });
    saveLicenseState({
      email: state.email,
      user_id: state.user_id,
      activation_code: activationCode,
      machine_fingerprint: machineFingerprint,
      license_id: data.license_id || "",
      edition: data.edition || "",
      expires_at: data.expires_at || "",
      valid: true,
      updated_at: new Date().toISOString(),
    });
    renderLicenseState();
    await refreshRelease();
    setMessage(
      els.licenseMessage,
      data.idempotent
        ? `授权已存在并恢复：${data.edition || "当前版本"}，有效期至 ${data.expires_at || "待确认"}。`
        : `授权已激活：${data.edition || "当前版本"}，有效期至 ${data.expires_at || "待确认"}。`,
      "success"
    );
  }

  async function onCheckLicense(event) {
    event.preventDefault();
    requireLogin();
    setMessage(els.licenseMessage, "正在检查授权状态...", "loading");
    await ensureCurrentLicenseLoaded();
    const licenseId = (licenseState.license_id || els.licenseId.value.trim() || "").trim();
    const activationCode = (els.activationCode.value.trim() || licenseState.activation_code || "").trim();
    const machineFingerprint = (els.machineFingerprint.value.trim() || licenseState.machine_fingerprint || "").trim();
    if (!licenseId && activationCode) {
      els.activationCode.value = activationCode;
      els.machineFingerprint.value = machineFingerprint;
      setLicenseStatus("待绑定设备", "待绑定");
      setMessage(
        els.licenseMessage,
        "当前账号已读取到激活码，但尚未生成 License ID。请从桌面端复制机器码后点击激活授权。",
        "warn"
      );
      return;
    }
    if (!licenseId || !machineFingerprint) {
      els.licenseId.value = licenseId;
      els.machineFingerprint.value = machineFingerprint;
      setLicenseStatus("待绑定设备", "待绑定");
      setMessage(
        els.licenseMessage,
        licenseId
          ? "已读取到 License ID，请从桌面端授权页面复制机器码后再检查。"
          : "当前账号还没有可用的 License ID。请先激活授权，或刷新当前授权状态。",
        "warn"
      );
      return;
    }
    const data = await request("/license/status", {
      method: "POST",
      body: {
        license_id: licenseId,
        machine_fingerprint: machineFingerprint,
        client_version: "web-account",
      },
      auth: true,
    });
    const type = data.valid ? "success" : "warn";
    saveLicenseState({
      email: state.email,
      user_id: state.user_id,
      activation_code: els.activationCode.value.trim() || licenseState.activation_code || "",
      machine_fingerprint: machineFingerprint,
      license_id: data.license_id || licenseId,
      edition: data.edition || licenseState.edition || "",
      expires_at: data.expires_at || licenseState.expires_at || "",
      valid: Boolean(data.valid),
      updated_at: new Date().toISOString(),
    });
    renderLicenseState();
    await refreshRelease();
    if (!data.valid) {
      data.message = userFacingLicenseError(data.message || data.reason || "unknown");
      data.reason = "";
    }
    setMessage(
      els.licenseMessage,
      data.valid ? "授权有效，可以回到桌面端同步数据。" : `授权不可用：${data.message || data.reason || "unknown"}`,
      type
    );
  }

  function userFacingLicenseError(value) {
    const text = String(value || "");
    if (text.includes("license_id_and_machine_fingerprint_required")) {
      return "请先完成授权绑定：License ID 会自动读取，机器码请从桌面端授权页面复制。";
    }
    if (text.includes("license_not_found")) {
      return "当前账号暂无可用 License ID，请先激活授权或刷新授权状态。";
    }
    if (text.includes("machine_mismatch") || text.includes("not match")) {
      return "当前机器码与授权记录不一致，请在桌面端复制本机机器码后重新绑定。";
    }
    return text || "授权状态暂不可用，请稍后重试。";
  }

  async function refreshRelease() {
    els.releaseBox.classList.add("loading");
    els.releaseState.textContent = "读取中";
    els.releaseVersion.textContent = "正在读取...";
    els.releaseMeta.textContent = "连接 Cloudflare API 获取最新发行信息。";
    if (!state.access_token) {
      state.current_release = null;
      els.releaseState.textContent = "待登录";
      els.releaseVersion.textContent = "登录后加载";
      els.releaseMeta.textContent = "请先登录用户中心，系统会按账号授权开放对应安装包。";
      els.downloadLink.href = "#";
      els.downloadLink.classList.add("disabled");
      els.downloadLink.setAttribute("aria-disabled", "true");
      els.releaseBox.classList.remove("loading");
      return;
    }
    try {
      await ensureCurrentLicenseLoaded();
      const data = await fetchLatestReleaseForAccount();
      state.current_release = data;
      els.releaseVersion.textContent = data.version || data.latest_version || "--";
      const editionText = releaseEditionLabel(data.edition || data.requested_edition);
      els.releaseMeta.textContent = data.release_notes
        ? `${editionText} · ${data.release_notes}`
        : `${editionText} · 发布时间：${data.release_date || "未提供"}`;
      if (data.download_available && data.download_endpoint) {
        els.releaseState.textContent = "可下载";
        els.downloadLink.href = "#";
        els.downloadLink.classList.remove("disabled");
        els.downloadLink.removeAttribute("aria-disabled");
      } else {
        els.releaseState.textContent = "暂无下载";
        els.downloadLink.href = "#";
        els.downloadLink.classList.add("disabled");
        els.downloadLink.setAttribute("aria-disabled", "true");
      }
    } catch (error) {
      els.releaseState.textContent = "暂不可用";
      els.releaseVersion.textContent = "暂不可用";
      els.releaseMeta.textContent = userFacingReleaseError(error);
    } finally {
      els.releaseBox.classList.remove("loading");
    }
  }

  async function refreshAccountData() {
    await refreshSavedLicenseStatus();
    await refreshRelease();
  }

  async function ensureCurrentLicenseLoaded() {
    if (!state.access_token) {
      return;
    }
    if (!isLicenseStateForCurrentUser() || !normalizeReleaseEdition(licenseState.edition)) {
      await loadCurrentLicense();
    }
  }

  async function fetchLatestReleaseForAccount() {
    const candidates = releaseEditionCandidates();
    const errors = [];
    for (const edition of candidates) {
      try {
        const data = await request(`/releases/latest?edition=${encodeURIComponent(edition)}&channel=${RELEASE_CHANNEL}`, {
          method: "GET",
          auth: true,
        });
        data.requested_edition = edition;
        return data;
      } catch (error) {
        errors.push({ edition, error });
        if (!isFallbackReleaseError(error)) {
          throw error;
        }
      }
    }
    const detail = errors
      .map((item) => `${releaseEditionLabel(item.edition)}: ${item.error.message || item.error.status || "不可用"}`)
      .join("；");
    throw new Error(detail || "当前账号暂无可下载的客户端安装包。");
  }

  function releaseEditionCandidates() {
    const licensedEdition = isLicenseStateForCurrentUser() ? normalizeReleaseEdition(licenseState.edition) : "";
    if (licensedEdition) {
      return [licensedEdition];
    }
    return RELEASE_EDITION_PRIORITY.slice();
  }

  function normalizeReleaseEdition(value) {
    const edition = String(value || "").trim().toLowerCase().replaceAll("-", "_");
    const aliases = {
      pro: "personal_pro",
      standard: "personal_standard",
      personal: "personal_standard",
    };
    const normalized = aliases[edition] || edition;
    return RELEASE_EDITION_PRIORITY.includes(normalized) ? normalized : "";
  }

  function releaseEditionLabel(value) {
    const edition = normalizeReleaseEdition(value);
    if (edition === "personal_pro") return "Personal Pro";
    if (edition === "personal_standard") return "Personal Standard";
    return "当前版本";
  }

  function isFallbackReleaseError(error) {
    return [403, 404].includes(Number(error && error.status));
  }

  function userFacingReleaseError(error) {
    const message = error && error.message ? error.message : "";
    if (message.includes("release_entitlement_required")) {
      return "当前账号没有对应版本的下载权益，请先激活或绑定授权。";
    }
    if (message.includes("release_not_found")) {
      return "当前授权版本暂未发布可下载安装包。";
    }
    return message || "发行信息读取失败。";
  }

  async function downloadRelease(event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    requireLogin();
    const release = state.current_release || {};
    if (!release.download_available || !release.download_endpoint) {
      throw new Error("当前账号暂无可下载的客户端安装包。");
    }
    els.downloadLink.classList.add("loading");
    els.downloadLink.setAttribute("aria-disabled", "true");
    setDownloadProgress({
      visible: true,
      percent: 0,
      text: "正在连接下载服务",
      meta: release.file_size_bytes ? `安装包大小 ${formatBytes(release.file_size_bytes)}` : "正在获取安装包大小。",
    });
    setMessage(els.authMessage, "正在下载客户端安装包，请保持页面打开。", "loading");
    try {
      const response = await fetch(apiUrl(release.download_endpoint), {
        method: "GET",
        headers: {
          authorization: `Bearer ${state.access_token}`,
        },
      });
      if (response.status === 401 && state.refresh_token) {
        const refreshed = await refreshToken();
        if (refreshed) {
          return downloadRelease(event);
        }
      }
      if (!response.ok) {
        const text = await response.text();
        let message = `下载失败：HTTP ${response.status}`;
        try {
          const data = text ? JSON.parse(text) : {};
          message = data.error || data.message || message;
        } catch {
          if (text) message = text;
        }
        throw new Error(message);
      }
      const total = Number(response.headers.get("content-length")) || Number(release.file_size_bytes) || 0;
      const fileName = release.file_name || fileNameFromDisposition(response.headers.get("content-disposition")) || "Scorpio-Intelligence-Setup.bin";
      const blob = await readDownloadBlob(response, total);
      setDownloadProgress({
        visible: true,
        percent: 100,
        text: "下载完成",
        meta: `${fileName} · ${formatBytes(blob.size)}`,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(els.authMessage, "安装包已下载完成，浏览器正在保存文件。", "success");
    } finally {
      els.downloadLink.classList.remove("loading");
      els.downloadLink.removeAttribute("aria-disabled");
    }
  }

  async function readDownloadBlob(response, total) {
    if (!response.body || !response.body.getReader) {
      const blob = await response.blob();
      setDownloadProgress({
        visible: true,
        percent: total ? 100 : 0,
        text: "下载完成",
        meta: formatBytes(blob.size),
      });
      return blob;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const percent = total ? Math.min(99, Math.floor((loaded / total) * 100)) : 0;
      setDownloadProgress({
        visible: true,
        percent,
        text: total ? `正在下载 ${percent}%` : "正在下载",
        meta: total ? `${formatBytes(loaded)} / ${formatBytes(total)}` : `已下载 ${formatBytes(loaded)}`,
      });
    }
    return new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
  }

  function apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (normalizedPath.startsWith("/v1/")) {
      return `${API_BASE.replace(/\/v1\/?$/, "")}${normalizedPath}`;
    }
    return `${API_BASE}${normalizedPath}`;
  }

  async function request(path, options) {
    const headers = { "content-type": "application/json" };
    if (options.auth) {
      requireLogin();
      headers.authorization = `Bearer ${state.access_token}`;
    }
    const response = await fetch(apiUrl(path), {
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
      const error = new Error(data.error || data.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
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
    els.nextStepText.textContent = loggedIn ? "激活或检查授权" : "登录后激活授权";
    els.syncState.textContent = loggedIn ? "等待授权" : "等待登录";
    els.logoutButton.disabled = !loggedIn;
    renderLicenseState();
  }

  function logout() {
    state.access_token = "";
    state.refresh_token = "";
    state.email = "";
    state.user_id = "";
    state.current_release = null;
    saveAuth();
    clearLicenseState();
    clearLicenseFields();
    renderSession();
    refreshRelease();
    setLicenseStatus("待激活", "待激活");
    setMessage(els.authMessage, "已退出登录。", "success");
  }

  function setLicenseStatus(stateText, chipText) {
    els.licenseState.textContent = stateText;
    els.licenseChip.textContent = chipText;
  }

  function applyActivationCodePayload(data) {
    const activationCode = String(data.activation_code || data.trial_activation_code || "").trim();
    if (!activationCode) {
      return false;
    }
    saveLicenseState({
      email: state.email,
      user_id: state.user_id,
      activation_code: activationCode,
      machine_fingerprint: licenseState.machine_fingerprint || "",
      license_id: licenseState.license_id || "",
      edition: data.activation_edition || data.trial_edition || data.edition || licenseState.edition || "",
      expires_at: licenseState.expires_at || "",
      valid: Boolean(licenseState.valid),
      updated_at: new Date().toISOString(),
    });
    els.activationCode.value = activationCode;
    renderLicenseState();
    return true;
  }

  function renderLicenseState() {
    const loggedIn = Boolean(state.access_token);
    if (!loggedIn || !isLicenseStateForCurrentUser()) {
      setLicenseStatus("待激活", "待激活");
      return;
    }

    els.activationCode.value = licenseState.activation_code || els.activationCode.value;
    els.machineFingerprint.value = licenseState.machine_fingerprint || els.machineFingerprint.value;
    els.licenseId.value = licenseState.license_id || els.licenseId.value;

    if (licenseState.valid && licenseState.license_id) {
      setLicenseStatus(licenseState.edition || "授权有效", "有效");
      els.nextStepText.textContent = "回到桌面端同步数据";
      els.syncState.textContent = "可同步";
      return;
    }

    if (licenseState.license_id) {
      setLicenseStatus("需要处理", "异常");
      els.nextStepText.textContent = "检查授权信息";
      els.syncState.textContent = "等待授权";
    } else if (licenseState.activation_code) {
      setLicenseStatus("待绑定设备", "待绑定");
      els.nextStepText.textContent = "从桌面端复制机器码后激活授权";
      els.syncState.textContent = "待绑定";
    } else {
      setLicenseStatus("待激活", "待激活");
      els.nextStepText.textContent = "登录后激活授权";
      els.syncState.textContent = "待激活";
    }
  }

  async function refreshSavedLicenseStatus() {
    if (!state.access_token) {
      return;
    }
    if (!isLicenseStateForCurrentUser() || !licenseState.license_id || !licenseState.machine_fingerprint) {
      await loadCurrentLicense();
      return;
    }
    try {
      const data = await request("/license/status", {
        method: "POST",
        body: {
          license_id: licenseState.license_id,
          machine_fingerprint: licenseState.machine_fingerprint,
          client_version: "web-account",
        },
        auth: true,
      });
      saveLicenseState({
        ...licenseState,
        valid: Boolean(data.valid),
        edition: data.edition || licenseState.edition || "",
        expires_at: data.expires_at || licenseState.expires_at || "",
        updated_at: new Date().toISOString(),
      });
      renderLicenseState();
    } catch {
      // Keep the last known local state; the visible status can still be checked manually.
    }
  }

  async function loadCurrentLicense() {
    try {
      const data = await request("/license/current", {
        method: "GET",
        auth: true,
      });
      if (!data.active || !data.license_id) {
        applyActivationCodePayload(data);
        return;
      }
      saveLicenseState({
        email: state.email,
        user_id: state.user_id,
        activation_code: licenseState.activation_code || "",
        machine_fingerprint: data.machine_fingerprint || "",
        license_id: data.license_id || "",
        edition: data.edition || "",
        expires_at: data.expires_at || "",
        valid: Boolean(data.valid),
        updated_at: new Date().toISOString(),
      });
      renderLicenseState();
    } catch {
      // A missing current license should not block login or release information.
    }
  }

  function isLicenseStateForCurrentUser() {
    return Boolean(
      (licenseState.license_id || licenseState.activation_code) &&
      state.email &&
      licenseState.email &&
      String(licenseState.email).toLowerCase() === String(state.email).toLowerCase()
    );
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

  function loadLicenseState() {
    try {
      return JSON.parse(localStorage.getItem(LICENSE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveLicenseState(nextState) {
    Object.keys(licenseState).forEach((key) => delete licenseState[key]);
    Object.assign(licenseState, nextState);
    localStorage.setItem(LICENSE_KEY, JSON.stringify(licenseState));
  }

  function clearLicenseState() {
    Object.keys(licenseState).forEach((key) => delete licenseState[key]);
    localStorage.removeItem(LICENSE_KEY);
  }

  function clearLicenseFields() {
    els.activationCode.value = "";
    els.machineFingerprint.value = "";
    els.licenseId.value = "";
  }

  function setMessage(el, text, type) {
    el.textContent = text;
    el.className = `account-message ${type || ""}`.trim();
  }

  function setDownloadProgress({ visible, percent, text, meta }) {
    if (!els.downloadProgress) return;
    els.downloadProgress.classList.toggle("hidden", !visible);
    if (typeof percent === "number") {
      const safePercent = Math.max(0, Math.min(100, percent));
      els.downloadProgressPercent.textContent = `${safePercent}%`;
      els.downloadProgressBar.style.width = `${safePercent}%`;
    }
    if (text) els.downloadProgressText.textContent = text;
    if (meta) els.downloadProgressMeta.textContent = meta;
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  function fileNameFromDisposition(value) {
    const text = String(value || "");
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(text);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1].replace(/^"|"$/g, ""));
    } catch {
      return match[1].replace(/^"|"$/g, "");
    }
  }

  function byId(id) {
    return document.getElementById(id);
  }
})();
