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
    customerQuery: "",
    customerStatus: "",
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
    customerId: byId("customerId"),
    customerSubmitButton: byId("customerSubmitButton"),
    clearCustomerFormButton: byId("clearCustomerFormButton"),
    codeForm: byId("codeForm"),
    codeCustomerSelect: byId("codeCustomerSelect"),
    releaseForm: byId("releaseForm"),
    generatedCodes: byId("generatedCodes"),
    refreshCustomersButton: byId("refreshCustomersButton"),
    refreshCodesButton: byId("refreshCodesButton"),
    refreshReleasesButton: byId("refreshReleasesButton"),
    refreshAllButton: byId("refreshAllButton"),
    customerTableToolbar: byId("customerTableToolbar"),
    customerSearch: byId("customerSearch"),
    customerStatusFilter: byId("customerStatusFilter"),
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
      const customerId = Number(payload.customer_id || 0);
      delete payload.customer_id;
      const result = customerId > 0
        ? await apiPut(`${ADMIN_PATH}/customers/${customerId}`, payload)
        : await apiPost(`${ADMIN_PATH}/customers`, payload);
      await loadCustomers();
      renderMetrics();
      clearCustomerForm();
      setMessage(`客户已保存：${result.customer_name || result.customer_email || result.id}`, "success");
    });
  });

  els.clearCustomerFormButton.addEventListener("click", () => {
    clearCustomerForm();
    setMessage("已切换为新建客户模式。", "success");
  });

  els.customersTable.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-customer-action]");
    if (!button) return;
    const customerId = Number(button.dataset.customerId || 0);
    if (button.dataset.customerAction === "edit") {
      editCustomer(customerId);
      return;
    }
    if (button.dataset.customerAction === "delete") {
      await deleteCustomer(customerId);
    }
  });

  els.codesTable.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-code-action]");
    if (!button) return;
    const code = button.dataset.code || "";
    if (button.dataset.codeAction === "copy") {
      await copyText(code);
      setMessage(`授权码已复制：${code}`, "success");
      return;
    }
    if (button.dataset.codeAction === "edit") {
      await editActivationCode(code);
      return;
    }
    if (button.dataset.codeAction === "revoke") {
      await revokeActivationCode(code);
    }
  });

  els.licensesTable.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-license-action]");
    if (!button) return;
    const licenseId = button.dataset.licenseId || "";
    if (button.dataset.licenseAction === "extend") {
      await extendLicense(licenseId);
      return;
    }
    if (button.dataset.licenseAction === "revoke") {
      await revokeLicense(licenseId);
      return;
    }
    if (button.dataset.licenseAction === "restore") {
      await restoreLicense(licenseId);
    }
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
  els.customerSearch.addEventListener("input", () => {
    state.customerQuery = els.customerSearch.value.trim().toLowerCase();
    renderCustomers();
  });
  els.customerStatusFilter.addEventListener("change", () => {
    state.customerStatus = els.customerStatusFilter.value;
    renderCustomers();
  });

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
    const rows = state.customers.filter((row) => {
      const matchesStatus = !state.customerStatus || row.status === state.customerStatus;
      const haystack = [
        row.customer_name,
        row.customer_email,
        row.edition,
        row.status,
        row.notes,
      ].join(" ").toLowerCase();
      const matchesQuery = !state.customerQuery || haystack.includes(state.customerQuery);
      return matchesStatus && matchesQuery;
    });
    if (!state.customers.length) {
      els.customersTable.innerHTML = '<div class="empty-state">暂无客户台账。新增测试客户后会在这里维护。</div>';
      return;
    }
    if (!rows.length) {
      els.customersTable.innerHTML = '<div class="empty-state">没有匹配的客户记录。请调整搜索条件或状态过滤。</div>';
      return;
    }
    els.customersTable.innerHTML = `
      <div class="admin-table-scroll">
        <table>
          <thead>
            <tr>
              <th>客户</th>
              <th>邮箱</th>
              <th>版本</th>
              <th>天数</th>
              <th>状态</th>
              <th>授权码</th>
              <th>已使用</th>
              <th>最近发码</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td><strong>${escapeHtml(row.customer_name || `客户#${row.id}`)}</strong></td>
                <td>${escapeHtml(row.customer_email || "-")}</td>
                <td>${escapeHtml(row.edition || "-")}</td>
                <td>${escapeHtml(row.license_days || "-")}</td>
                <td>${escapeHtml(customerStatusLabel(row.status))}</td>
                <td>${escapeHtml(row.activation_code_count || 0)}</td>
                <td>${escapeHtml(row.used_code_count || 0)}</td>
                <td>${escapeHtml(formatDate(row.latest_code_created_at))}</td>
                <td>${escapeHtml(formatDate(row.updated_at))}</td>
                <td>
                  <div class="table-actions">
                    <button class="text-action" type="button" data-customer-action="edit" data-customer-id="${escapeHtml(row.id)}">编辑</button>
                    <button class="text-action danger" type="button" data-customer-action="delete" data-customer-id="${escapeHtml(row.id)}">删除</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
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

  function editCustomer(customerId) {
    const row = state.customers.find((item) => Number(item.id) === Number(customerId));
    if (!row) {
      setMessage("未找到这条客户记录，请刷新客户台账后重试。", "warn");
      return;
    }
    const fields = els.customerForm.elements;
    fields.customer_id.value = row.id || "";
    fields.customer_name.value = row.customer_name || "";
    fields.customer_email.value = row.customer_email || "";
    fields.edition.value = row.edition || "personal_pro";
    fields.license_days.value = row.license_days || 365;
    fields.status.value = row.status || "draft";
    fields.machine_fingerprint_prebind.value = row.machine_fingerprint_prebind || "";
    fields.notes.value = row.notes || "";
    els.customerSubmitButton.textContent = "更新客户";
    setMessage(`正在编辑客户：${row.customer_name || row.customer_email || row.id}`, "success");
    els.customerForm.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearCustomerForm() {
    els.customerForm.reset();
    els.customerId.value = "";
    els.customerForm.elements.edition.value = "personal_pro";
    els.customerForm.elements.license_days.value = 365;
    els.customerForm.elements.status.value = "draft";
    els.customerSubmitButton.textContent = "保存客户";
  }

  async function deleteCustomer(customerId) {
    const row = state.customers.find((item) => Number(item.id) === Number(customerId));
    if (!row) {
      setMessage("未找到这条客户记录，请刷新客户台账后重试。", "warn");
      return;
    }
    const label = row.customer_name || row.customer_email || `客户#${row.id}`;
    const codeCount = Number(row.activation_code_count || 0);
    const prompt = codeCount > 0
      ? `${label} 已有关联授权码，将改为“已取消/归档”，保留审计链路。确认处理？`
      : `确认删除测试客户 ${label}？`;
    if (!window.confirm(prompt)) return;

    await runAdminAction("正在处理客户记录...", async () => {
      const result = await apiDelete(`${ADMIN_PATH}/customers/${customerId}`);
      await loadCustomers();
      renderMetrics();
      if (Number(els.customerId.value || 0) === Number(customerId)) {
        clearCustomerForm();
      }
      setMessage(result.archived ? `客户已归档：${label}` : `客户已删除：${label}`, "success");
    });
  }

  function renderCodes() {
    if (!state.codes.length) {
      els.codesTable.innerHTML = '<div class="empty-state">暂无授权码</div>';
      return;
    }
    els.codesTable.innerHTML = `
      <div class="admin-table-scroll">
        <table>
          <thead>
            <tr>
              <th>授权码</th>
              <th>版本</th>
              <th>天数</th>
              <th>设备</th>
              <th>状态</th>
              <th>客户</th>
              <th>客户邮箱</th>
              <th>创建时间</th>
              <th>使用时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${state.codes.map((row) => `
              <tr>
                <td><strong>${escapeHtml(row.code)}</strong></td>
                <td>${escapeHtml(row.edition || "-")}</td>
                <td>${escapeHtml(row.license_days || "-")}</td>
                <td>${escapeHtml(row.max_devices || "-")}</td>
                <td>${escapeHtml(statusLabel(row.status))}</td>
                <td>${escapeHtml(row.customer_name || (row.customer_id ? `客户#${row.customer_id}` : "-"))}</td>
                <td>${escapeHtml(row.customer_email || "-")}</td>
                <td>${escapeHtml(formatDate(row.created_at))}</td>
                <td>${escapeHtml(formatDate(row.used_at))}</td>
                <td>
                  <div class="table-actions">
                    <button class="text-action" type="button" data-code-action="copy" data-code="${escapeHtml(row.code)}">复制</button>
                    <button class="text-action" type="button" data-code-action="edit" data-code="${escapeHtml(row.code)}">编辑</button>
                    <button class="text-action danger" type="button" data-code-action="revoke" data-code="${escapeHtml(row.code)}" ${row.status === "used" ? "disabled" : ""}>撤销</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderLicenses() {
    if (!state.licenses.length) {
      els.licensesTable.innerHTML = '<div class="empty-state">暂无授权记录</div>';
      return;
    }
    els.licensesTable.innerHTML = `
      <div class="admin-table-scroll">
        <table>
          <thead>
            <tr>
              <th>授权 ID</th>
              <th>授权码</th>
              <th>版本</th>
              <th>客户邮箱</th>
              <th>机器指纹</th>
              <th>到期时间</th>
              <th>状态</th>
              <th>审批</th>
              <th>最近在线</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${state.licenses.map((row) => `
              <tr>
                <td><strong>${escapeHtml(shortText(row.license_id, 20))}</strong></td>
                <td>${escapeHtml(row.activation_code || "-")}</td>
                <td>${escapeHtml(row.edition || "-")}</td>
                <td>${escapeHtml(row.email || "-")}</td>
                <td>${escapeHtml(shortText(row.machine_fingerprint || "-", 22))}</td>
                <td>${escapeHtml(formatDate(row.expires_at))}</td>
                <td>${escapeHtml(row.revoked ? "已撤销" : row.is_active ? "有效" : "停用")}</td>
                <td>${escapeHtml(row.approval_status || "-")}</td>
                <td>${escapeHtml(formatDate(row.last_online_check))}</td>
                <td>
                  <div class="table-actions">
                    <button class="text-action" type="button" data-license-action="extend" data-license-id="${escapeHtml(row.license_id)}">延期</button>
                    ${row.revoked
                      ? `<button class="text-action" type="button" data-license-action="restore" data-license-id="${escapeHtml(row.license_id)}">恢复</button>`
                      : `<button class="text-action danger" type="button" data-license-action="revoke" data-license-id="${escapeHtml(row.license_id)}">撤销</button>`}
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  async function editActivationCode(code) {
    const row = state.codes.find((item) => item.code === code);
    if (!row) return;
    const days = window.prompt("授权天数。已使用的授权码不会反向修改已签发授权。", row.license_days || 365);
    if (days === null) return;
    const maxDevices = window.prompt("设备数。已使用的授权码不会反向修改已签发授权。", row.max_devices || 1);
    if (maxDevices === null) return;
    const status = row.status === "used" ? "used" : (window.prompt("状态：active / assigned / suspended / revoked", row.status || "active") || row.status);
    await runAdminAction("正在更新授权码...", async () => {
      await apiPut(`${ADMIN_PATH}/activation-codes/${encodeURIComponent(code)}`, {
        license_days: Number(days || row.license_days || 365),
        max_devices: Number(maxDevices || row.max_devices || 1),
        status,
        customer_name: row.customer_name || "",
        customer_email: row.customer_email || "",
        machine_fingerprint_prebind: row.machine_fingerprint_prebind || "",
        notes: row.notes || "",
      });
      await loadCodes();
      renderMetrics();
      setMessage("授权码已更新。已签发授权请在“授权记录”中单独延期或撤销。", "success");
    });
  }

  async function revokeActivationCode(code) {
    const row = state.codes.find((item) => item.code === code);
    if (!row) return;
    if (row.status === "used") {
      setMessage("已使用授权码不能直接撤销，请在授权记录中撤销或延期对应授权。", "warn");
      return;
    }
    if (!window.confirm(`确认撤销授权码 ${code}？`)) return;
    await runAdminAction("正在撤销授权码...", async () => {
      await apiDelete(`${ADMIN_PATH}/activation-codes/${encodeURIComponent(code)}`);
      await loadCodes();
      renderMetrics();
      setMessage(`授权码已撤销：${code}`, "success");
    });
  }

  async function extendLicense(licenseId) {
    const row = state.licenses.find((item) => item.license_id === licenseId);
    if (!row) return;
    const days = window.prompt("从当前到期日继续延期天数", "30");
    if (days === null) return;
    const value = Number(days);
    if (!Number.isFinite(value) || value <= 0) {
      setMessage("延期天数必须大于 0。", "warn");
      return;
    }
    await runAdminAction("正在延期并重新签名授权...", async () => {
      await apiPut(`${ADMIN_PATH}/licenses/${encodeURIComponent(licenseId)}`, {
        extend_days: value,
        is_active: true,
        revoked: false,
        approval_status: row.approval_status || "auto",
      });
      await loadLicenses();
      renderMetrics();
      setMessage("授权已延期并重新签名。客户端在线校验或刷新授权后生效。", "success");
    });
  }

  async function revokeLicense(licenseId) {
    if (!window.confirm(`确认撤销授权 ${licenseId}？`)) return;
    await runAdminAction("正在撤销授权...", async () => {
      await apiDelete(`${ADMIN_PATH}/licenses/${encodeURIComponent(licenseId)}`);
      await loadLicenses();
      renderMetrics();
      setMessage("授权已撤销。", "success");
    });
  }

  async function restoreLicense(licenseId) {
    const row = state.licenses.find((item) => item.license_id === licenseId);
    if (!row) return;
    await runAdminAction("正在恢复并重新签名授权...", async () => {
      await apiPut(`${ADMIN_PATH}/licenses/${encodeURIComponent(licenseId)}`, {
        expires_at: String(row.expires_at || "").slice(0, 10) || undefined,
        is_active: true,
        revoked: false,
        revoke_reason: "",
        approval_status: row.approval_status || "auto",
      });
      await loadLicenses();
      renderMetrics();
      setMessage("授权已恢复。", "success");
    });
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

  async function apiPut(path, body) {
    return parseResponse(await fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  async function apiDelete(path) {
    return parseResponse(await fetch(`${API_BASE}${path}`, {
      method: "DELETE",
      headers: adminHeaders(),
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

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
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
    els.customerTableToolbar.classList.toggle("hidden", tab !== "customers");
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
      customer_id_invalid: "客户 ID 无效，请刷新台账后重试。",
      customer_not_found: "客户记录不存在，可能已被删除，请刷新台账。",
      customer_identity_required: "客户名称和客户邮箱至少填写一项。",
      email_invalid: "客户邮箱格式不正确。",
      customer_has_activation_codes: "该客户已有授权码或授权记录，不能硬删除；请编辑状态为暂停或取消。",
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
