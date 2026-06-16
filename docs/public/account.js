(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";
  const STORAGE_KEY = "scorpio_account_session";
  const TRIAL_KEY = "scorpio_trial_activation_code";

  const state = {
    session: readSession(),
    trialCode: localStorage.getItem(TRIAL_KEY) || "",
    codeCooldown: {},
  };

  const els = {
    accountLayout: byId("accountLayout"),
    accountGate: byId("accountGate"),
    accountPrivate: byId("accountPrivate"),
    accountStatus: byId("accountStatus"),
    statAccount: byId("statAccount"),
    statAccountMeta: byId("statAccountMeta"),
    statTrial: byId("statTrial"),
    statRelease: byId("statRelease"),
    statReleaseMeta: byId("statReleaseMeta"),
    authMessage: byId("authMessage"),
    authTabs: byId("authTabs"),
    loginForm: byId("loginForm"),
    registerForm: byId("registerForm"),
    resetForm: byId("resetForm"),
    sessionPanel: byId("sessionPanel"),
    sessionEmail: byId("sessionEmail"),
    downloadIntro: byId("downloadIntro"),
    releaseVersion: byId("releaseVersion"),
    releaseChannel: byId("releaseChannel"),
    releaseDate: byId("releaseDate"),
    releaseHash: byId("releaseHash"),
    downloadButton: byId("downloadButton"),
    refreshReleaseButton: byId("refreshReleaseButton"),
    trialIntro: byId("trialIntro"),
    trialCode: byId("trialCode"),
    copyTrialButton: byId("copyTrialButton"),
    logoutButton: byId("logoutButton"),
  };

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => switchAuthTab(button.dataset.authTab));
  });

  document.querySelectorAll("[data-send-code]").forEach((button) => {
    button.addEventListener("click", () => sendVerificationCode(button));
  });

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.loginForm);
    await runAuthAction("正在登录...", async () => {
      const session = await apiPost("/auth/login", {
        email: data.email,
        password: data.password,
      });
      saveSession(session);
      setMessage("登录成功，用户中心已开放。", "success");
      await refreshRelease();
    });
  });

  els.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.registerForm);
    if (data.password !== data.password_confirm) {
      setMessage("两次输入的密码不一致。", "error");
      return;
    }
    await runAuthAction("正在创建账号...", async () => {
      const result = await apiPost("/auth/register", {
        email: data.email,
        password: data.password,
        username: data.username || data.email.split("@")[0],
        verification_code: data.verification_code,
      });

      if (result.trial_activation_code) {
        state.trialCode = result.trial_activation_code;
        localStorage.setItem(TRIAL_KEY, state.trialCode);
      }

      const session = await apiPost("/auth/login", {
        email: data.email,
        password: data.password,
      });
      saveSession(session);
      render();
      setMessage("注册成功，已领取试用资格并登录。", "success");
      await refreshRelease();
    });
  });

  els.resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.resetForm);
    if (data.password !== data.password_confirm) {
      setMessage("两次输入的新密码不一致。", "error");
      return;
    }
    await runAuthAction("正在重置密码...", async () => {
      await apiPost("/auth/reset-password", {
        email: data.email,
        verification_code: data.verification_code,
        new_password: data.password,
      });
      els.resetForm.reset();
      switchAuthTab("login");
      setMessage("密码已重置，请使用新密码登录。", "success");
    });
  });

  els.refreshReleaseButton.addEventListener("click", refreshRelease);

  els.copyTrialButton.addEventListener("click", async () => {
    if (!state.trialCode) {
      setMessage("当前还没有可复制的试用激活码。", "warn");
      return;
    }
    try {
      await navigator.clipboard.writeText(state.trialCode);
      setMessage("试用激活码已复制。", "success");
    } catch {
      setMessage("浏览器未允许复制，请手动选中激活码。", "warn");
    }
  });

  els.logoutButton.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state.session = null;
    render();
    renderRelease(null, "login_required");
    setMessage("已退出登录。", "success");
  });

  render();
  if (state.session) {
    refreshRelease();
  } else {
    renderRelease(null, "login_required");
  }

  function switchAuthTab(tab) {
    if (state.session) return;
    document.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.authTab === tab);
    });
    els.loginForm.classList.toggle("hidden", tab !== "login");
    els.registerForm.classList.toggle("hidden", tab !== "register");
    els.resetForm.classList.toggle("hidden", tab !== "reset");
    setMessage("", "");
  }

  async function sendVerificationCode(button) {
    const purpose = button.dataset.sendCode;
    const form = purpose === "register" ? els.registerForm : els.resetForm;
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email) {
      setMessage("请先填写邮箱。", "warn");
      return;
    }
    if (state.codeCooldown[purpose] > Date.now()) {
      setMessage("验证码已发送，请稍后再试。", "warn");
      return;
    }

    await runAuthAction("正在发送验证码...", async () => {
      await apiPost("/auth/send-code", { email, purpose });
      state.codeCooldown[purpose] = Date.now() + 60000;
      startCodeCountdown(button, 60);
      setMessage("验证码已发送，请查收邮箱。", "success");
    });
  }

  function startCodeCountdown(button, seconds) {
    let remain = seconds;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = `${remain}s`;
    const timer = setInterval(() => {
      remain -= 1;
      if (remain <= 0) {
        clearInterval(timer);
        button.disabled = false;
        button.textContent = originalText;
        return;
      }
      button.textContent = `${remain}s`;
    }, 1000);
  }

  async function runAuthAction(loadingText, task) {
    setMessage(loadingText, "loading");
    setBusy(true);
    try {
      await task();
    } catch (error) {
      setMessage(errorToText(error), "error");
    } finally {
      setBusy(false);
      render();
    }
  }

  async function refreshRelease() {
    if (!state.session) {
      renderRelease(null, "login_required");
      return;
    }

    setReleaseLoading(true);
    try {
      const release = await apiGet("/releases/latest?edition=personal_pro&channel=stable");
      renderRelease(release);
    } catch (error) {
      renderRelease(null, error.code || "release_error");
    } finally {
      setReleaseLoading(false);
    }
  }

  async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    return parseResponse(response);
  }

  async function apiPost(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    return parseResponse(response);
  }

  async function parseResponse(response) {
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const error = new Error(payload.error || `http_${response.status}`);
      error.code = payload.error || `http_${response.status}`;
      throw error;
    }
    return payload;
  }

  function render() {
    renderAuthState();
    renderTrialState();
  }

  function renderAuthState() {
    if (state.session) {
      const email = state.session.email || "Scorpio 用户";
      els.authTabs.classList.add("hidden");
      els.loginForm.classList.add("hidden");
      els.registerForm.classList.add("hidden");
      els.resetForm.classList.add("hidden");
      els.sessionPanel.classList.remove("hidden");
      els.accountGate.classList.add("hidden");
      els.accountPrivate.classList.remove("hidden");
      els.sessionEmail.textContent = email;
      els.logoutButton.classList.remove("hidden");
      els.accountStatus.innerHTML = '<span class="badge-dot online"></span><strong>已登录</strong>';
      els.statAccount.textContent = "已登录";
      els.statAccountMeta.textContent = email;
      els.downloadIntro.textContent = "已登录。下方展示当前稳定版客户端安装包，下载地址来自后台发行记录。";
      return;
    }

    const activeTab = document.querySelector("[data-auth-tab].active")?.dataset.authTab || "login";
    els.authTabs.classList.remove("hidden");
    els.loginForm.classList.toggle("hidden", activeTab !== "login");
    els.registerForm.classList.toggle("hidden", activeTab !== "register");
    els.resetForm.classList.toggle("hidden", activeTab !== "reset");
    els.sessionPanel.classList.add("hidden");
    els.accountGate.classList.remove("hidden");
    els.accountPrivate.classList.add("hidden");
    els.sessionEmail.textContent = "-";
    els.logoutButton.classList.add("hidden");
    els.accountStatus.innerHTML = '<span class="badge-dot"></span><strong>未登录</strong>';
    els.statAccount.textContent = "未登录";
    els.statAccountMeta.textContent = "需要登录后下载";
    els.downloadIntro.textContent = "请先登录。登录后会读取后台发行记录并开放安装包下载按钮。";
  }

  function renderTrialState() {
    els.copyTrialButton.disabled = !state.trialCode;
    if (state.trialCode && state.session) {
      els.trialCode.textContent = state.trialCode;
      els.statTrial.textContent = "已领取";
      els.trialIntro.textContent = "这是最近一次注册生成的试用激活码。安装客户端后输入激活码完成授权。";
      return;
    }

    els.trialCode.textContent = "暂无";
    els.statTrial.textContent = "待领取";
    els.trialIntro.textContent = "注册成功后这里会显示试用激活码。安装客户端后输入激活码完成授权。";
  }

  function renderRelease(release, reason) {
    if (!release) {
      disableDownload();
      els.releaseChannel.textContent = "stable";
      els.releaseDate.textContent = "-";
      els.releaseHash.textContent = "-";

      if (reason === "login_required") {
        els.releaseVersion.textContent = "登录后加载";
        els.statRelease.textContent = "待登录";
        els.statReleaseMeta.textContent = "登录后读取发行信息";
      } else if (reason === "release_not_found") {
        els.releaseVersion.textContent = "安装包准备中";
        els.statRelease.textContent = "未配置";
        els.statReleaseMeta.textContent = "后台未录入发行包";
        els.downloadIntro.textContent = "后台还没有录入正式发行包地址，请稍后刷新或联系商务邮箱。";
      } else {
        els.releaseVersion.textContent = "读取失败";
        els.statRelease.textContent = "读取失败";
        els.statReleaseMeta.textContent = "请稍后重试";
        els.downloadIntro.textContent = "发行信息读取失败，请稍后重试，或联系 guotao7021@gmail.com。";
      }
      return;
    }

    const version = release.version || release.latest_version || "未知版本";
    els.releaseVersion.textContent = `v${String(version).replace(/^v/i, "")}`;
    els.releaseChannel.textContent = release.channel || "stable";
    els.releaseDate.textContent = release.release_date || "-";
    els.releaseHash.textContent = release.sha256 ? `${release.sha256.slice(0, 12)}...` : "-";
    els.statRelease.textContent = `v${String(version).replace(/^v/i, "")}`;
    els.statReleaseMeta.textContent = release.download_url ? "可下载" : "缺少下载地址";

    if (release.download_url) {
      els.downloadButton.href = release.download_url;
      els.downloadButton.classList.remove("disabled");
      els.downloadButton.removeAttribute("aria-disabled");
      els.downloadButton.textContent = "下载";
      els.downloadIntro.textContent = "当前稳定版安装包已就绪。下载后请使用账号试用码或正式授权码完成激活。";
    } else {
      disableDownload();
      els.downloadButton.textContent = "暂无链接";
      els.downloadIntro.textContent = "当前发行记录缺少 download_url，请先在后台补充安装包地址。";
    }
  }

  function disableDownload() {
    els.downloadButton.href = "#";
    els.downloadButton.classList.add("disabled");
    els.downloadButton.setAttribute("aria-disabled", "true");
    els.downloadButton.textContent = "下载";
  }

  function setReleaseLoading(isLoading) {
    els.refreshReleaseButton.disabled = isLoading;
    if (isLoading) {
      els.statReleaseMeta.textContent = "正在读取发行信息...";
    }
  }

  function setBusy(isBusy) {
    document.querySelectorAll(".auth-form button[type='submit']").forEach((button) => {
      button.disabled = isBusy;
    });
    if (!isBusy) {
      renderTrialState();
    }
  }

  function setMessage(text, type) {
    els.authMessage.textContent = text || "";
    els.authMessage.className = `account-message ${type || ""}`.trim();
  }

  function saveSession(session) {
    state.session = session;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  function readSession() {
    try {
      const session = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return session && session.access_token ? session : null;
    } catch {
      return null;
    }
  }

  function formData(form) {
    const data = new FormData(form);
    return Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value).trim()]));
  }

  function errorToText(error) {
    const code = error && error.code ? error.code : "";
    const map = {
      email_invalid: "邮箱格式不正确。",
      password_too_short: "密码至少需要 8 位。",
      invalid_credentials: "邮箱或密码不正确。",
      email_exists: "该邮箱已经注册，请直接登录。",
      verification_code_required: "请输入邮箱验证码。",
      verification_code_invalid: "验证码不正确或已过期。",
      verification_code_expired: "验证码已过期，请重新发送。",
      email_not_verified: "邮箱还没有完成验证。",
      email_delivery_not_configured: "邮件验证码服务还没有配置，请联系管理员完成邮件发送配置。",
      email_delivery_failed: "验证码邮件发送失败，请稍后重试。",
      verification_purpose_invalid: "验证码用途不正确，请刷新页面后重试。",
      release_not_found: "后台还没有录入正式发行包。",
      failed_to_fetch: "网络请求失败，请确认官网域名和 API 域名已经生效。",
    };
    return map[code] || map[String(error.message || "").toLowerCase()] || `操作失败：${code || error.message || "unknown_error"}`;
  }

  function byId(id) {
    return document.getElementById(id);
  }
})();
