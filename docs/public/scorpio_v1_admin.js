(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";
  const ADMIN_PATH = "/scorpio_v1_admin";
  const TOKEN_KEY = "scorpio_admin_token";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    customers: [],
    codes: [],
    licenses: [],
    releases: [],
  };

  const els = {
    adminLogin: byId("adminLogin"),
    adminLoginForm: byId("adminLoginForm"),
    adminLoginToken: byId("adminLoginToken"),
    loginMessage: byId("loginMessage"),
    adminTopbar: byId("adminTopbar"),
    adminConsole: byId("adminConsole"),
    adminStatus: byId("adminStatus"),
    adminToken: byId("adminToken"),
    logoutButton: byId("logoutButton"),
    saveTokenButton: byId("saveTokenButton"),
    clearTokenButton: byId("clearTokenButton"),
    adminMessage: byId("adminMessage"),
    customerForm: byId("customerForm"),
    codeForm: byId("codeForm"),
    codeCustomerSelect: byId("codeCustomerSelect"),
    releaseForm: byId("releaseForm"),
    generatedCodes: byId("generatedCodes"),
    refreshCustomersButton: byId("refreshCustomersButton"),
    refreshCodesButton: byId("refreshCodesButton"),
    refreshReleasesButton: byId("refreshReleasesButton"),
    refreshAllButton: byId("refreshAllButton"),
    customersTable: byId("customersTable"),
    codesTable: byId("codesTable"),
    licensesTable: byId("licensesTable"),
    releasesTable: byId("releasesTable"),
    metricCustomers: byId("metricCustomers"),
    metricCustomersMeta: byId("metricCustomersMeta"),
    metricCodes: byId("metricCodes"),
    metricCodesMeta: byId("metricCodesMeta"),
    metricLicenses: byId("metricLicenses"),
    metricLicensesMeta: byId("metricLicensesMeta"),
    metricReleases: byId("metricReleases"),
    metricReleasesMeta: byId("metricReleasesMeta"),
    metricApi: byId("metricApi"),
  };

  els.adminToken.value = state.token;
  els.adminLoginToken.value = state.token;

  els.adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = els.adminLoginToken.value.trim();
    if (!token) {
      setLoginMessage("请输入 Admin Token。", "warn");
      return;
    }
    state.token = token;
    localStorage.setItem(TOKEN_KEY, token);
    els.adminToken.value = token;
    setLoginMessage("正在验证管理员身份...", "loading");
    const ok = await refreshAll();
    if (ok) {
      setLoginMessage("", "");
      showConsole();
    } else {
      localStorage.removeItem(TOKEN_KEY);
      state.token = "";
      els.adminToken.value = "";
      els.adminLoginToken.focus();
    }
  });

  els.logoutButton.addEventListener("click", () => {
    clearSession("已退出管理员后台。");
  });

  els.saveTokenButton.addEventListener("click", async () => {
    state.token = els.adminToken.value.trim();
    if (!state.token) {
      setMessage("请先输入 Admin Token。", "warn");
      renderStatus(false);
      return;
    }
    localStorage.setItem(TOKEN_KEY, state.token);
    els.adminLoginToken.value = state.token;
    const ok = await refreshAll();
    if (ok) showConsole();
  });

  els.clearTokenButton.addEventListener("click", () => {
    clearSession("已清除本地 Token。");
  });

  els.customerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAdminAction("正在保存客户台账...", async () => {
      const payload = formPayload(els.customerForm);
      payload.license_days = Number(payload.license_days || 365);
      const result = await apiPost(`${ADMIN_PATH}/customers`, payload);
      await loadCustomers();
      renderMetrics();
      setMessage(`客户已保存：${result.customer_name || result.customer_email || result.id}`, "success");
    });
  });

  els.codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAdminAction("正在生成授权码...", async () => {
      const payload = formPayload(els.codeForm);
      payload.customer_id = payload.customer_id ? Number(payload.customer_id) : undefined;
      payload.count = Number(payload.count || 1);
      payload.license_days = Number(payload.license_days || 365);
      payload.max_devices = Number(payload.max_devices || 1);
      const result = await apiPost(`${ADMIN_PATH}/activation-codes`, payload);
      renderGeneratedCodes(result.codes || []);
      await loadCustomers();
      await loadCodes();
      renderMetrics();
      setMessage("授权码已生成，并已刷新列表。", "success");
    });
  });

  els.releaseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAdminAction("正在保存发行记录...", async () => {
      const payload = formPayload(els.releaseForm);
      payload.file_size_bytes = Number(payload.file_size_bytes || 0);
      payload.is_required = Boolean(payload.is_required);
      await apiPost(`${ADMIN_PATH}/releases`, payload);
      await loadReleases();
      renderMetrics();
      setMessage("发行记录已保存。用户交付页会读取最新 stable 记录。", "success");
    });
  });

  els.refreshCodesButton.addEventListener("click", () => runAdminAction("正在刷新授权码...", async () => {
    await loadCodes();
    renderMetrics();
  }));
  els.refreshCustomersButton.addEventListener("click", () => runAdminAction("正在刷新客户台账...", async () => {
    await loadCustomers();
    renderMetrics();
  }));
  els.refreshReleasesButton.addEventListener("click", () => runAdminAction("正在刷新发行包...", async () => {
    await loadReleases();
    renderMetrics();
  }));
  els.refreshAllButton.addEventListener("click", refreshAll);

  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.adminTab));
  });

  showLogin();
  renderStatus(false);
  renderAllTables();
  renderMetrics();
  if (state.token) {
    setLoginMessage("正在恢复管理员登录...", "loading");
    refreshAll().then((ok) => {
      if (ok) {
        setLoginMessage("", "");
        showConsole();
      } else {
        localStorage.removeItem(TOKEN_KEY);
        state.token = "";
        els.adminToken.value = "";
      }
    });
  }

  async function refreshAll() {
    return runAdminAction("正在连接管理员 API...", async () => {
      const results = await Promise.allSettled([loadCustomers(), loadCodes(), loadLicenses(), loadReleases()]);
      const rejected = results.filter((item) => item.status === "rejected");
      const tokenError = rejected.find((item) => item.reason && item.reason.code === "admin_token_required");
      if (tokenError) {
        throw tokenError.reason;
      }
      if (rejected.length) {
        throw rejected[0].reason || new Error("admin_api_unavailable");
      }
      renderStatus(true);
      renderMetrics();
      if (rejected.some((item) => item.reason && item.reason.code === "not_found")) {
        setMessage("基础管理员接口已连接；发行包接口需要重新部署 Cloudflare Worker 后可用。", "warn");
        return;
      }
      setMessage("管理员 API 已连接。", "success");
    });
  }

  async function loadCustomers() {
    const data = await apiGet(`${ADMIN_PATH}/customers`);
    state.customers = data.results || [];
    renderCustomers();
    renderCustomerOptions();
  }

  async function loadCodes() {
    const data = await apiGet(`${ADMIN_PATH}/activation-codes`);
    state.codes = data.results || [];
    renderCodes();
  }

  async function loadLicenses() {
    const data = await apiGet(`${ADMIN_PATH}/licenses`);
    state.licenses = data.results || [];
    renderLicenses();
  }

  async function loadReleases() {
    const data = await apiGet(`${ADMIN_PATH}/releases`);
    state.releases = data.results || [];
    renderReleases();
  }

  function renderAllTables() {
    renderCustomers();
    renderCodes();
    renderLicenses();
    renderReleases();
    renderCustomerOptions();
  }

  function renderCustomers() {
    renderTable(els.customersTable, ["客户", "邮箱", "版本", "天数", "状态", "授权码", "已使用", "最近发码", "更新时间"], state.customers.map((row) => [
      row.customer_name || "-",
      row.customer_email || "-",
      row.edition || "-",
      row.license_days || "-",
      customerStatusLabel(row.status),
      row.activation_code_count || 0,
      row.used_code_count || 0,
      formatDate(row.latest_code_created_at),
      formatDate(row.updated_at),
    ]));
  }

  function renderCustomerOptions() {
    const selected = els.codeCustomerSelect.value;
    els.codeCustomerSelect.innerHTML = [
      '<option value="">不关联台账</option>',
      ...state.customers.map((row) => {
        const label = `${row.customer_name || row.customer_email || `客户#${row.id}`} ${row.customer_email ? `(${row.customer_email})` : ""}`;
        return `<option value="${escapeHtml(row.id)}">${escapeHtml(label)}</option>`;
      }),
    ].join("");
    if ([...els.codeCustomerSelect.options].some((option) => option.value === selected)) {
      els.codeCustomerSelect.value = selected;
    }
  }

  function renderCodes() {
    renderTable(els.codesTable, ["授权码", "版本", "天数", "设备", "状态", "客户", "客户邮箱", "创建时间", "使用时间"], state.codes.map((row) => [
      row.code,
      row.edition,
      row.license_days,
      row.max_devices,
      statusLabel(row.status),
      row.customer_name || (row.customer_id ? `客户#${row.customer_id}` : "-"),
      row.customer_email || "-",
      formatDate(row.created_at),
      formatDate(row.used_at),
    ]));
  }

  function renderLicenses() {
    renderTable(els.licensesTable, ["授权 ID", "版本", "邮箱", "机器指纹", "到期", "有效", "审批", "最近在线"], state.licenses.map((row) => [
      shortText(row.license_id, 18),
      row.edition,
      row.email || "-",
      shortText(row.machine_fingerprint || "-", 22),
      formatDate(row.expires_at),
      row.revoked ? "已撤销" : row.is_active ? "有效" : "停用",
      row.approval_status || "-",
      formatDate(row.last_online_check),
    ]));
  }

  function renderReleases() {
    renderTable(els.releasesTable, ["版本", "通道", "版本类型", "下载地址", "SHA256", "强制", "发布时间"], state.releases.map((row) => [
      `v${String(row.version || "").replace(/^v/i, "")}`,
      row.channel,
      row.edition,
      shortText(row.download_url || "-", 46),
      row.file_hash_sha256 ? shortText(row.file_hash_sha256, 18) : "-",
      row.is_required ? "是" : "否",
      formatDate(row.released_at),
    ]));
  }

  function renderMetrics() {
    const activeCustomers = state.customers.filter((row) => ["active", "issued"].includes(row.status)).length;
    const activeCodes = state.codes.filter((row) => row.status === "active" || row.status === "assigned").length;
    const usedCodes = state.codes.filter((row) => row.status === "used").length;
    const activeLicenses = state.licenses.filter((row) => row.is_active && !row.revoked).length;
    const latestRelease = state.releases[0];

    els.metricCustomers.textContent = state.customers.length ? String(state.customers.length) : "-";
    els.metricCustomersMeta.textContent = state.customers.length ? `活跃/已交付 ${activeCustomers}` : "等待连接";
    els.metricCodes.textContent = state.codes.length ? String(state.codes.length) : "-";
    els.metricCodesMeta.textContent = state.codes.length ? `可用 ${activeCodes} / 已用 ${usedCodes}` : "等待连接";
    els.metricLicenses.textContent = state.licenses.length ? String(activeLicenses) : "-";
    els.metricLicensesMeta.textContent = state.licenses.length ? `总记录 ${state.licenses.length}` : "等待连接";
    els.metricReleases.textContent = latestRelease ? `v${String(latestRelease.version || "").replace(/^v/i, "")}` : "-";
    els.metricReleasesMeta.textContent = latestRelease ? `${latestRelease.channel} / ${latestRelease.edition}` : "等待发行记录";
    els.metricApi.textContent = state.token ? "已连接" : "未连接";
  }

  async function apiGet(path) {
    return parseResponse(await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: adminHeaders(),
    }));
  }

  async function apiPost(path, body) {
    return parseResponse(await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  function adminHeaders() {
    return {
      accept: "application/json",
      "x-admin-token": state.token,
    };
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

  async function runAdminAction(loadingText, task) {
    if (!state.token) {
      setMessage("请先输入 Admin Token。", "warn");
      renderStatus(false);
      return false;
    }
    setMessage(loadingText, "loading");
    setBusy(true);
    try {
      await task();
      renderStatus(true);
      return true;
    } catch (error) {
      renderStatus(false);
      const text = errorToText(error);
      setMessage(text, "error");
      setLoginMessage(text, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function showLogin() {
    els.adminLogin.classList.remove("hidden");
    els.adminTopbar.classList.add("hidden");
    els.adminConsole.classList.add("hidden");
  }

  function showConsole() {
    els.adminLogin.classList.add("hidden");
    els.adminTopbar.classList.remove("hidden");
    els.adminConsole.classList.remove("hidden");
  }

  function clearSession(message) {
    state.token = "";
    state.customers = [];
    state.codes = [];
    state.licenses = [];
    state.releases = [];
    localStorage.removeItem(TOKEN_KEY);
    els.adminToken.value = "";
    els.adminLoginToken.value = "";
    renderStatus(false);
    renderAllTables();
    renderMetrics();
    showLogin();
    setLoginMessage(message, "success");
    setMessage("", "");
  }

  function renderStatus(isConnected) {
    els.adminStatus.innerHTML = isConnected
      ? '<span class="badge-dot online"></span><div><strong>已连接</strong><small>管理员 API 可用</small></div>'
      : '<span class="badge-dot"></span><div><strong>未连接</strong><small>输入 Admin Token 后读取数据</small></div>';
  }

  function renderGeneratedCodes(codes) {
    els.generatedCodes.classList.toggle("hidden", codes.length === 0);
    els.generatedCodes.innerHTML = codes.length
      ? `<strong>本次生成</strong><pre>${escapeHtml(codes.join("\n"))}</pre>`
      : "";
  }

  function renderTable(container, headers, rows) {
    if (!rows.length) {
      container.innerHTML = '<div class="empty-state">暂无数据</div>';
      return;
    }
    container.innerHTML = `
      <div class="admin-table-scroll">
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function switchTab(tab) {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminTab === tab);
    });
    els.codesTable.classList.toggle("hidden", tab !== "codes");
    els.customersTable.classList.toggle("hidden", tab !== "customers");
    els.licensesTable.classList.toggle("hidden", tab !== "licenses");
    els.releasesTable.classList.toggle("hidden", tab !== "releases");
  }

  function setBusy(isBusy) {
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function setMessage(text, type) {
    els.adminMessage.textContent = text || "";
    els.adminMessage.className = `admin-message ${type || ""}`.trim();
  }

  function setLoginMessage(text, type) {
    els.loginMessage.textContent = text || "";
    els.loginMessage.className = `admin-message ${type || ""}`.trim();
  }

  function formPayload(form) {
    const data = new FormData(form);
    const payload = {};
    data.forEach((value, key) => {
      payload[key] = String(value).trim();
    });
    form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      payload[input.name] = input.checked;
    });
    return payload;
  }

  function statusLabel(status) {
    const map = { active: "可用", assigned: "已分配", used: "已使用", revoked: "已撤销" };
    return map[status] || status || "-";
  }

  function customerStatusLabel(status) {
    const map = { draft: "草稿", active: "活跃", issued: "已交付", suspended: "暂停", cancelled: "取消" };
    return map[status] || status || "-";
  }

  function formatDate(value) {
    if (!value) return "-";
    return String(value).replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
  }

  function errorToText(error) {
    const code = error && error.code ? error.code : "";
    const map = {
      admin_token_required: "Admin Token 不正确或未配置。",
      version_required: "请填写安装包版本号。",
      download_url_https_required: "下载地址必须使用 https://。",
      not_found: "当前 API 版本还没有部署对应管理员接口，请先重新部署 Cloudflare Worker。",
      "failed to fetch": "管理员登录校验失败，请确认官网域名已生效，或稍后重试。",
      failed_to_fetch: "管理员登录校验失败，请确认官网域名已生效，或稍后重试。",
    };
    return map[code] || `操作失败：${code || error.message || "unknown_error"}`;
  }

  function shortText(value, maxLength) {
    const text = String(value || "");
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    })[char]);
  }

  function byId(id) {
    return document.getElementById(id);
  }
})();
