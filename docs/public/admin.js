(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";
  const TOKEN_KEY = "scorpio_admin_token";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
  };

  const els = {
    adminStatus: byId("adminStatus"),
    adminToken: byId("adminToken"),
    saveTokenButton: byId("saveTokenButton"),
    clearTokenButton: byId("clearTokenButton"),
    adminMessage: byId("adminMessage"),
    codeForm: byId("codeForm"),
    releaseForm: byId("releaseForm"),
    generatedCodes: byId("generatedCodes"),
    refreshCodesButton: byId("refreshCodesButton"),
    refreshReleasesButton: byId("refreshReleasesButton"),
    refreshAllButton: byId("refreshAllButton"),
    codesTable: byId("codesTable"),
    licensesTable: byId("licensesTable"),
    releasesTable: byId("releasesTable"),
  };

  els.adminToken.value = state.token;

  els.saveTokenButton.addEventListener("click", async () => {
    state.token = els.adminToken.value.trim();
    if (!state.token) {
      setMessage("请先输入 Admin Token。", "warn");
      renderStatus(false);
      return;
    }
    localStorage.setItem(TOKEN_KEY, state.token);
    await refreshAll();
  });

  els.clearTokenButton.addEventListener("click", () => {
    state.token = "";
    localStorage.removeItem(TOKEN_KEY);
    els.adminToken.value = "";
    renderStatus(false);
    clearTables();
    setMessage("已清除本地 Token。", "success");
  });

  els.codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAdminAction("正在生成授权码...", async () => {
      const payload = formPayload(els.codeForm);
      payload.count = Number(payload.count || 1);
      payload.license_days = Number(payload.license_days || 365);
      payload.max_devices = Number(payload.max_devices || 1);
      const result = await apiPost("/admin/activation-codes", payload);
      renderGeneratedCodes(result.codes || []);
      await loadCodes();
      setMessage("授权码已生成。", "success");
    });
  });

  els.releaseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAdminAction("正在保存发行记录...", async () => {
      const payload = formPayload(els.releaseForm);
      payload.file_size_bytes = Number(payload.file_size_bytes || 0);
      payload.is_required = Boolean(payload.is_required);
      await apiPost("/admin/releases", payload);
      await loadReleases();
      setMessage("发行记录已保存。用户交付页会读取最新 stable 记录。", "success");
    });
  });

  els.refreshCodesButton.addEventListener("click", () => runAdminAction("正在刷新授权码...", loadCodes));
  els.refreshReleasesButton.addEventListener("click", () => runAdminAction("正在刷新发行包...", loadReleases));
  els.refreshAllButton.addEventListener("click", refreshAll);

  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.adminTab));
  });

  renderStatus(Boolean(state.token));
  if (state.token) {
    refreshAll();
  } else {
    clearTables();
  }

  async function refreshAll() {
    await runAdminAction("正在连接管理员 API...", async () => {
      const results = await Promise.allSettled([loadCodes(), loadLicenses(), loadReleases()]);
      const rejected = results.filter((item) => item.status === "rejected");
      const tokenError = rejected.find((item) => item.reason && item.reason.code === "admin_token_required");
      if (tokenError) {
        throw tokenError.reason;
      }
      if (rejected.some((item) => item.reason && item.reason.code === "not_found")) {
        renderTable(els.releasesTable, [], []);
        setMessage("基础管理员接口已连接；发行包接口需要重新部署 Cloudflare Worker 后可用。", "warn");
      }
      renderStatus(true);
      if (!rejected.length) {
        setMessage("管理员 API 已连接。", "success");
      }
    });
  }

  async function loadCodes() {
    const data = await apiGet("/admin/activation-codes");
    renderTable(els.codesTable, ["授权码", "版本", "天数", "设备", "状态", "客户邮箱", "创建时间", "使用时间"], (data.results || []).map((row) => [
      row.code,
      row.edition,
      row.license_days,
      row.max_devices,
      row.status,
      row.customer_email || "-",
      row.created_at || "-",
      row.used_at || "-",
    ]));
  }

  async function loadLicenses() {
    const data = await apiGet("/admin/licenses");
    renderTable(els.licensesTable, ["授权 ID", "版本", "邮箱", "机器指纹", "到期", "有效", "审批", "最近在线"], (data.results || []).map((row) => [
      row.license_id,
      row.edition,
      row.email || "-",
      shortText(row.machine_fingerprint || "-", 22),
      row.expires_at || "-",
      row.revoked ? "已撤销" : row.is_active ? "有效" : "停用",
      row.approval_status || "-",
      row.last_online_check || "-",
    ]));
  }

  async function loadReleases() {
    const data = await apiGet("/admin/releases");
    renderTable(els.releasesTable, ["版本", "通道", "版本类型", "下载地址", "SHA256", "强制", "发布时间"], (data.results || []).map((row) => [
      row.version,
      row.channel,
      row.edition,
      shortText(row.download_url || "-", 42),
      row.file_hash_sha256 ? shortText(row.file_hash_sha256, 18) : "-",
      row.is_required ? "是" : "否",
      row.released_at || "-",
    ]));
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
      return;
    }
    setMessage(loadingText, "loading");
    setBusy(true);
    try {
      await task();
      renderStatus(true);
    } catch (error) {
      renderStatus(false);
      setMessage(errorToText(error), "error");
    } finally {
      setBusy(false);
    }
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
    els.licensesTable.classList.toggle("hidden", tab !== "licenses");
    els.releasesTable.classList.toggle("hidden", tab !== "releases");
  }

  function clearTables() {
    renderTable(els.codesTable, [], []);
    renderTable(els.licensesTable, [], []);
    renderTable(els.releasesTable, [], []);
  }

  function setBusy(isBusy) {
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function setMessage(text, type) {
    els.adminMessage.textContent = text || "";
    els.adminMessage.className = `account-message ${type || ""}`.trim();
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

  function errorToText(error) {
    const code = error && error.code ? error.code : "";
    const map = {
      admin_token_required: "Admin Token 不正确或未配置。",
      version_required: "请填写安装包版本号。",
      download_url_https_required: "下载地址必须使用 https://。",
      not_found: "当前 API 版本还没有部署对应管理员接口，请先重新部署 Cloudflare Worker。",
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
