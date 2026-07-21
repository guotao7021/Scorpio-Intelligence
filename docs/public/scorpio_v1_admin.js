(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";
  const ADMIN_PATH = "/scorpio_v1_admin";
  const TOKEN_KEY = "scorpio_admin_token";
  localStorage.removeItem(TOKEN_KEY);

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || "",
    overview: null,
    signingHealth: null,
    customers: [],
    codes: [],
    licenses: [],
    releases: [],
    auditEvents: [],
    usageReports: [],
    analysisRequests: [],
    customerQuery: "",
    customerStatus: "",
    showTestRecords: false,
    currentTab: "customers",
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
    generatedCodes: byId("generatedCodes"),
    releaseForm: byId("releaseForm"),
    refreshCustomersButton: byId("refreshCustomersButton"),
    refreshCodesButton: byId("refreshCodesButton"),
    refreshReleasesButton: byId("refreshReleasesButton"),
    refreshAllButton: byId("refreshAllButton"),
    showTestRecordsToggle: byId("showTestRecordsToggle"),
    customerTableToolbar: byId("customerTableToolbar"),
    customerSearch: byId("customerSearch"),
    customerStatusFilter: byId("customerStatusFilter"),
    customersTable: byId("customersTable"),
    codesTable: byId("codesTable"),
    licensesTable: byId("licensesTable"),
    releasesTable: byId("releasesTable"),
    auditTable: byId("auditTable"),
    usageTable: byId("usageTable"),
    analysisTable: byId("analysisTable"),
    metricCustomers: byId("metricCustomers"),
    metricCustomersMeta: byId("metricCustomersMeta"),
    metricUsers: byId("metricUsers"),
    metricUsersMeta: byId("metricUsersMeta"),
    metricLicensedUsers: byId("metricLicensedUsers"),
    metricLicensedUsersMeta: byId("metricLicensedUsersMeta"),
    metricVisits: byId("metricVisits"),
    metricVisitsMeta: byId("metricVisitsMeta"),
    metricCodes: byId("metricCodes"),
    metricCodesMeta: byId("metricCodesMeta"),
    metricLicenses: byId("metricLicenses"),
    metricLicensesMeta: byId("metricLicensesMeta"),
    metricReleases: byId("metricReleases"),
    metricReleasesMeta: byId("metricReleasesMeta"),
    metricApi: byId("metricApi"),
  };

  init();

  function init() {
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
      sessionStorage.setItem(TOKEN_KEY, token);
      els.adminToken.value = token;
      setLoginMessage("正在验证管理员身份...", "loading");
      const ok = await refreshAll();
      if (ok) {
        setLoginMessage("", "");
        showConsole();
      } else {
        clearStoredToken();
      }
    });

    els.logoutButton.addEventListener("click", () => clearSession("已退出管理员后台。"));
    els.saveTokenButton.addEventListener("click", async () => {
      state.token = els.adminToken.value.trim();
      if (!state.token) {
        setMessage("请先输入 Admin Token。", "warn");
        renderStatus(false);
        return;
      }
      sessionStorage.setItem(TOKEN_KEY, state.token);
      els.adminLoginToken.value = state.token;
      const ok = await refreshAll();
      if (ok) showConsole();
    });
    els.clearTokenButton.addEventListener("click", () => clearSession("已清除本地 Token。"));

    els.customerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await runAdminAction("正在保存客户台账...", async () => {
        const payload = formPayload(els.customerForm);
        const customerId = Number(payload.customer_id || 0);
        payload.license_days = Number(payload.license_days || 365);
        delete payload.customer_id;
        const result = customerId > 0
          ? await apiPut(`${ADMIN_PATH}/customers/${customerId}`, payload)
          : await apiPost(`${ADMIN_PATH}/customers`, payload);
        await loadCustomers();
        if (isTestRecord(result)) {
          state.showTestRecords = true;
          if (els.showTestRecords) els.showTestRecords.checked = true;
        }
        renderMetrics();
        renderCustomerOptions();
        clearCustomerForm();
        const suffix = isTestRecord(result) ? "；已自动打开“显示测试记录”。" : "";
        setMessage(`客户已保存：${result.customer_name || result.customer_email || result.id}${suffix}`, "success");
      });
    });

    els.clearCustomerFormButton.addEventListener("click", () => {
      clearCustomerForm();
      setMessage("已切换为新建客户模式。", "success");
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
        await Promise.all([loadCustomers(), loadCodes()]);
        renderMetrics();
        renderCustomerOptions();
        setMessage("授权码已生成并刷新列表。", "success");
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
        setMessage("发行记录已保存，用户中心会读取最新 stable 记录。", "success");
      });
    });

    els.customersTable.addEventListener("click", onCustomerTableClick);
    els.codesTable.addEventListener("click", onCodesTableClick);
    els.licensesTable.addEventListener("click", onLicensesTableClick);
    els.refreshCustomersButton.addEventListener("click", () => runAdminAction("正在刷新客户台账...", loadCustomersAndRender));
    els.refreshCodesButton.addEventListener("click", () => runAdminAction("正在刷新授权码...", loadCodesAndRender));
    els.refreshReleasesButton.addEventListener("click", () => runAdminAction("正在刷新发行包...", loadReleasesAndRender));
    els.refreshAllButton.addEventListener("click", refreshAll);
    els.showTestRecordsToggle.addEventListener("change", () => {
      state.showTestRecords = els.showTestRecordsToggle.checked;
      renderAllTables();
      renderMetrics();
    });
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
      refreshAll().then((ok) => {
        if (ok) showConsole();
      });
    }
  }

  async function onCustomerTableClick(event) {
    const button = event.target.closest("[data-customer-action]");
    if (!button) return;
    const customerId = Number(button.dataset.customerId || 0);
    if (button.dataset.customerAction === "edit") editCustomer(customerId);
    if (button.dataset.customerAction === "delete") await deleteCustomer(customerId);
    if (button.dataset.customerAction === "force-delete") await forceDeleteCustomer(customerId);
  }

  async function onCodesTableClick(event) {
    const button = event.target.closest("[data-code-action]");
    if (!button) return;
    const code = button.dataset.code || "";
    if (button.dataset.codeAction === "copy") {
      await copyText(code);
      setMessage(`授权码已复制：${code}`, "success");
      return;
    }
    if (button.dataset.codeAction === "edit") await editActivationCode(code);
    if (button.dataset.codeAction === "revoke") await revokeActivationCode(code);
    if (button.dataset.codeAction === "force-delete") await forceDeleteActivationCode(code);
  }

  async function onLicensesTableClick(event) {
    const button = event.target.closest("[data-license-action]");
    if (!button) return;
    const licenseId = button.dataset.licenseId || "";
    if (button.dataset.licenseAction === "copy-machine") {
      await copyText(button.dataset.machineFingerprint || "");
      setMessage("机器码已复制。", "success");
      return;
    }
    if (button.dataset.licenseAction === "copy-license") {
      await copyText(licenseId);
      setMessage("授权 ID 已复制。", "success");
      return;
    }
    if (button.dataset.licenseAction === "download") await downloadLicense(licenseId);
    if (button.dataset.licenseAction === "extend") await extendLicense(licenseId);
    if (button.dataset.licenseAction === "revoke") await revokeLicense(licenseId);
    if (button.dataset.licenseAction === "restore") await restoreLicense(licenseId);
    if (button.dataset.licenseAction === "force-delete") await forceDeleteLicense(licenseId);
  }

  async function refreshAll() {
    if (!state.token) {
      renderStatus(false);
      return false;
    }
    try {
      setMessage("正在读取运营数据...", "loading");
      await Promise.all([
        loadOverview(),
        loadSigningHealth(),
        loadCustomers(),
        loadCodes(),
        loadLicenses(),
        loadReleases(),
        loadAuditEvents(),
        loadUsageReports(),
        loadAnalysisRequests(),
      ]);
      renderStatus(true);
      renderAllTables();
      renderMetrics();
      renderCustomerOptions();
      setMessage("运营数据已刷新。", "success");
      return true;
    } catch (error) {
      renderStatus(false);
      setMessage(error.message || "后台连接失败。", "error");
      setLoginMessage(error.message || "后台连接失败。", "error");
      return false;
    }
  }

  async function loadCustomersAndRender() {
    await loadCustomers();
    renderCustomers();
    renderCustomerOptions();
    renderMetrics();
  }

  async function loadCodesAndRender() {
    await loadCodes();
    renderCodes();
    renderMetrics();
  }

  async function loadReleasesAndRender() {
    await loadReleases();
    renderReleases();
    renderMetrics();
  }

  async function loadOverview() {
    state.overview = await apiGet(`${ADMIN_PATH}/overview`);
  }

  async function loadSigningHealth() {
    state.signingHealth = await apiGet(`${ADMIN_PATH}/signing/health`);
  }

  async function loadCustomers() {
    const data = await apiGet(`${ADMIN_PATH}/customers?limit=500`);
    state.customers = listPayload(data, "customers");
  }

  async function loadCodes() {
    const data = await apiGet(`${ADMIN_PATH}/activation-codes?limit=500`);
    state.codes = listPayload(data, "codes");
  }

  async function loadLicenses() {
    const data = await apiGet(`${ADMIN_PATH}/licenses?limit=500`);
    state.licenses = listPayload(data, "licenses");
  }

  async function loadReleases() {
    const data = await apiGet(`${ADMIN_PATH}/releases?limit=100`);
    state.releases = listPayload(data, "releases");
  }

  async function loadAuditEvents() {
    const data = await apiGet(`${ADMIN_PATH}/audit-events?limit=100`);
    state.auditEvents = listPayload(data, "events");
  }

  async function loadUsageReports() {
    const data = await apiGet(`${ADMIN_PATH}/usage-reports?limit=100`);
    state.usageReports = listPayload(data, "reports");
  }

  async function loadAnalysisRequests() {
    const data = await apiGet(`${ADMIN_PATH}/analysis-requests?limit=100`);
    state.analysisRequests = listPayload(data, "requests");
  }

  function renderAllTables() {
    renderCustomers();
    renderCodes();
    renderLicenses();
    renderReleases();
    renderAuditEvents();
    renderUsageReports();
    renderAnalysisRequests();
    switchTab(state.currentTab);
  }

  function renderCustomers() {
    const baseRows = visibleRows(state.customers);
    const hiddenTestCount = state.customers.length - baseRows.length;
    const rows = baseRows.filter((row) => {
      const matchesStatus = !state.customerStatus || row.status === state.customerStatus;
      const text = [row.customer_name, row.customer_email, row.edition, row.status, row.notes].join(" ").toLowerCase();
      return matchesStatus && (!state.customerQuery || text.includes(state.customerQuery));
    });
    if (!baseRows.length) {
      const hiddenHint = hiddenTestCount > 0 ? `当前隐藏了 ${hiddenTestCount} 条测试记录，勾选右上角“显示测试记录”后可维护。` : "新增客户后会在这里维护。";
      els.customersTable.innerHTML = `<div class="empty-state">暂无客户台账。${escapeHtml(hiddenHint)}</div>`;
      return;
    }
    if (!rows.length) {
      els.customersTable.innerHTML = '<div class="empty-state">没有匹配的客户记录，请调整搜索条件。</div>';
      return;
    }
    els.customersTable.innerHTML = tableHtml(
      ["客户", "邮箱", "版本", "天数", "状态", "授权码", "已使用", "最近发码", "更新", "操作"],
      rows.map((row) => [
        `<strong>${escapeHtml(row.customer_name || `客户#${row.id}`)}</strong>`,
        escapeHtml(row.customer_email || "-"),
        escapeHtml(row.edition || "-"),
        escapeHtml(row.license_days || "-"),
        escapeHtml(customerStatusLabel(row.status)),
        escapeHtml(row.activation_code_count || 0),
        escapeHtml(row.used_code_count || 0),
        escapeHtml(formatDate(row.latest_code_created_at)),
        escapeHtml(formatDate(row.updated_at)),
        `<div class="table-actions">
          <button class="text-action" type="button" data-customer-action="edit" data-customer-id="${escapeAttr(row.id)}">编辑</button>
          <button class="text-action danger" type="button" data-customer-action="delete" data-customer-id="${escapeAttr(row.id)}">删除/归档</button>
          ${isTestRecord(row) ? `<button class="text-action danger" type="button" data-customer-action="force-delete" data-customer-id="${escapeAttr(row.id)}">硬删除测试记录</button>` : ""}
        </div>`,
      ])
    );
  }

  function renderCustomerOptions() {
    const selected = els.codeCustomerSelect.value;
    els.codeCustomerSelect.innerHTML = [
      '<option value="">不关联台账</option>',
      ...visibleRows(state.customers).map((row) => {
        const label = `${row.customer_name || row.customer_email || `客户#${row.id}`}${row.customer_email ? ` (${row.customer_email})` : ""}`;
        return `<option value="${escapeAttr(row.id)}">${escapeHtml(label)}</option>`;
      }),
    ].join("");
    if ([...els.codeCustomerSelect.options].some((option) => option.value === selected)) {
      els.codeCustomerSelect.value = selected;
    }
  }

  function renderCodes() {
    const rows = visibleRows(state.codes);
    if (!rows.length) {
      els.codesTable.innerHTML = '<div class="empty-state">暂无授权码。</div>';
      return;
    }
    els.codesTable.innerHTML = tableHtml(
      ["授权码", "版本", "天数", "设备", "状态", "客户", "邮箱", "创建", "使用", "操作"],
      rows.map((row) => [
        `<strong>${escapeHtml(row.code)}</strong>`,
        escapeHtml(row.edition || "-"),
        escapeHtml(row.license_days || "-"),
        escapeHtml(row.max_devices || "-"),
        escapeHtml(statusLabel(row.status)),
        escapeHtml(row.customer_name || (row.customer_id ? `客户#${row.customer_id}` : "-")),
        escapeHtml(row.customer_email || "-"),
        escapeHtml(formatDate(row.created_at)),
        escapeHtml(formatDate(row.used_at)),
        `<div class="table-actions">
          <button class="text-action" type="button" data-code-action="copy" data-code="${escapeAttr(row.code)}">复制</button>
          <button class="text-action" type="button" data-code-action="edit" data-code="${escapeAttr(row.code)}">编辑</button>
          <button class="text-action danger" type="button" data-code-action="revoke" data-code="${escapeAttr(row.code)}" ${row.status === "used" ? "disabled" : ""}>撤销</button>
          ${isTestRecord(row) ? `<button class="text-action danger" type="button" data-code-action="force-delete" data-code="${escapeAttr(row.code)}">硬删除测试记录</button>` : ""}
        </div>`,
      ])
    );
  }

  function renderLicenses() {
    const rows = visibleRows(state.licenses);
    if (!rows.length) {
      els.licensesTable.innerHTML = state.licenses.length
        ? '<div class="empty-state">测试授权记录已隐藏。打开“显示测试记录”可查看。</div>'
        : '<div class="empty-state">暂无授权记录。</div>';
      return;
    }
    els.licensesTable.innerHTML = `
      <div class="license-record-list">
        ${rows.map((row) => licenseCard(row)).join("")}
      </div>
    `;
  }

  function licenseCard(row) {
    const licenseId = row.license_id || "-";
    const machineFingerprint = row.machine_fingerprint || "-";
    const statusText = row.revoked ? "已撤销" : row.is_active ? "有效" : "停用";
    return `
      <article class="license-record">
        <div class="license-record-head">
          <div class="license-identity">
            <strong>${escapeHtml(row.email || row.username || "-")}</strong>
            <span>${escapeHtml(row.edition || "-")} / ${escapeHtml(statusText)} / ${escapeHtml(row.approval_status || "-")}</span>
          </div>
          <div class="table-actions">
            <button class="text-action" type="button" data-license-action="copy-license" data-license-id="${escapeAttr(licenseId)}">复制授权 ID</button>
            <button class="text-action" type="button" data-license-action="copy-machine" data-machine-fingerprint="${escapeAttr(row.machine_fingerprint || "")}" data-license-id="${escapeAttr(licenseId)}">复制机器码</button>
            <button class="text-action" type="button" data-license-action="download" data-license-id="${escapeAttr(licenseId)}">下载授权文件</button>
            <button class="text-action" type="button" data-license-action="extend" data-license-id="${escapeAttr(licenseId)}">延期/编辑</button>
            ${row.revoked
              ? `<button class="text-action" type="button" data-license-action="restore" data-license-id="${escapeAttr(licenseId)}">恢复</button>`
              : `<button class="text-action danger" type="button" data-license-action="revoke" data-license-id="${escapeAttr(licenseId)}">撤销</button>`}
            ${isTestRecord(row) ? `<button class="text-action danger" type="button" data-license-action="force-delete" data-license-id="${escapeAttr(licenseId)}">硬删除测试记录</button>` : ""}
          </div>
        </div>
        <div class="license-meta-grid">
          <div><span>授权 ID</span><code>${escapeHtml(licenseId)}</code></div>
          <div><span>授权码</span><code>${escapeHtml(row.activation_code || "-")}</code></div>
          <div><span>到期日</span><strong>${escapeHtml(formatDate(row.expires_at))}</strong></div>
          <div><span>最近在线</span><strong>${escapeHtml(formatDate(row.last_online_check))}</strong></div>
        </div>
        <div class="machine-block">
          <span>机器指纹</span>
          <code class="machine-fingerprint" title="${escapeAttr(machineFingerprint)}">${escapeHtml(machineFingerprint)}</code>
        </div>
      </article>
    `;
  }

  function renderReleases() {
    renderTable(els.releasesTable, ["版本", "通道", "版本类型", "来源", "文件", "大小", "下载", "状态", "发布时间"], state.releases.map((row) => [
      `v${String(row.version || "").replace(/^v/i, "")}`,
      row.channel || "-",
      row.edition || "-",
      shortText(row.r2_key || row.hk_download_url || row.download_url || "-", 46),
      shortText(row.file_name || "-", 28),
      formatBytes(row.file_size_bytes),
      row.download_count || 0,
      Number(row.is_active ?? 1) ? (row.is_required ? "强制" : "可用") : "停用",
      formatDate(row.released_at),
    ]));
  }

  function renderAuditEvents() {
    renderTable(els.auditTable, ["时间", "操作", "操作者", "内容"], state.auditEvents.map((row) => [
      formatDate(row.created_at),
      row.action,
      row.actor,
      shortText(row.payload || "-", 90),
    ]));
  }

  function renderUsageReports() {
    renderTable(els.usageTable, ["时间", "授权", "机器", "版本", "会话秒数"], state.usageReports.map((row) => [
      formatDate(row.created_at || row.session_start),
      shortText(row.license_id || "-", 24),
      shortText(row.machine_fingerprint || "-", 28),
      row.client_version || "-",
      row.session_duration_seconds || "-",
    ]));
  }

  function renderAnalysisRequests() {
    renderTable(els.analysisTable, ["时间", "接口", "标的", "状态", "耗时"], state.analysisRequests.map((row) => [
      formatDate(row.created_at),
      row.endpoint || "-",
      [row.asset_type, row.asset_code].filter(Boolean).join(":") || "-",
      row.status || "-",
      row.latency_ms ? `${row.latency_ms}ms` : "-",
    ]));
  }

  function renderGeneratedCodes(codes) {
    if (!codes.length) {
      els.generatedCodes.classList.add("hidden");
      els.generatedCodes.innerHTML = "";
      return;
    }
    els.generatedCodes.classList.remove("hidden");
    els.generatedCodes.innerHTML = `
      <strong>本次生成</strong>
      <div class="code-list">
        ${codes.map((code) => `<code>${escapeHtml(code)}</code>`).join("")}
      </div>
    `;
  }

  function editCustomer(customerId) {
    const row = state.customers.find((item) => Number(item.id) === Number(customerId));
    if (!row) {
      setMessage("未找到这条客户记录，请刷新后重试。", "warn");
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
      setMessage("未找到这条客户记录，请刷新后重试。", "warn");
      return;
    }
    const label = row.customer_name || row.customer_email || `客户#${row.id}`;
    const linked = Number(row.activation_code_count || 0);
    const prompt = linked > 0
      ? `${label} 已有关联授权码或授权记录，将归档为“取消”以保留审计链路。确认处理？`
      : `确认删除客户 ${label}？`;
    if (!window.confirm(prompt)) return;
    await runAdminAction("正在处理客户记录...", async () => {
      const result = await apiDelete(`${ADMIN_PATH}/customers/${customerId}`);
      await loadCustomers();
      renderCustomerOptions();
      renderCustomers();
      renderMetrics();
      if (Number(els.customerId.value || 0) === Number(customerId)) clearCustomerForm();
      setMessage(result.archived ? `客户已归档：${label}` : `客户已删除：${label}`, "success");
    });
  }

  async function forceDeleteCustomer(customerId) {
    const row = state.customers.find((item) => Number(item.id) === Number(customerId));
    if (!row) {
      setMessage("未找到这条客户记录，请刷新后重试。", "warn");
      return;
    }
    const label = row.customer_name || row.customer_email || `客户#${row.id}`;
    const confirmation = window.prompt(`硬删除会级联删除 ${label} 的授权码、授权记录、校验日志和使用上报。仅用于清理测试数据。\n请输入 DELETE_TEST_RECORDS 确认。`);
    if (confirmation !== "DELETE_TEST_RECORDS") {
      setMessage("已取消硬删除。", "warn");
      return;
    }
    await runAdminAction("正在硬删除测试客户记录...", async () => {
      const result = await apiDelete(`${ADMIN_PATH}/customers/${customerId}?force=1&confirm=DELETE_TEST_RECORDS`);
      await refreshAll();
      setMessage(`测试客户已硬删除：${label}，授权码 ${result.activation_code_count || 0} 条，授权记录 ${result.license_count || 0} 条。`, "success");
    });
  }

  async function editActivationCode(code) {
    const row = state.codes.find((item) => item.code === code);
    if (!row) return;
    const days = promptNumber("授权天数。已使用授权码不会反向修改已签发授权。", row.license_days || 365);
    if (days === null) return;
    const maxDevices = promptNumber("设备数。已使用授权码不会反向修改已签发授权。", row.max_devices || 1);
    if (maxDevices === null) return;
    const status = row.status === "used"
      ? "used"
      : (window.prompt("状态：active / assigned / suspended / revoked", row.status || "active") || row.status);
    await runAdminAction("正在更新授权码...", async () => {
      await apiPut(`${ADMIN_PATH}/activation-codes/${encodeURIComponent(code)}`, {
        license_days: days,
        max_devices: maxDevices,
        status,
        customer_name: row.customer_name || "",
        customer_email: row.customer_email || "",
        machine_fingerprint_prebind: row.machine_fingerprint_prebind || "",
        notes: row.notes || "",
      });
      await loadCodes();
      renderCodes();
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
      renderCodes();
      renderMetrics();
      setMessage(`授权码已撤销：${code}`, "success");
    });
  }

  async function forceDeleteActivationCode(code) {
    const confirmation = window.prompt(`硬删除会级联删除授权码 ${code} 关联的授权记录、校验日志和使用上报。仅用于清理测试数据。\n请输入 DELETE_TEST_RECORDS 确认。`);
    if (confirmation !== "DELETE_TEST_RECORDS") {
      setMessage("已取消硬删除。", "warn");
      return;
    }
    await runAdminAction("正在硬删除测试授权码...", async () => {
      const result = await apiDelete(`${ADMIN_PATH}/activation-codes/${encodeURIComponent(code)}?force=1&confirm=DELETE_TEST_RECORDS`);
      await refreshAll();
      setMessage(`测试授权码已硬删除：${code}，关联授权记录 ${result.license_count || 0} 条。`, "success");
    });
  }

  async function downloadLicense(licenseId) {
    if (!licenseId || licenseId === "-") return;
    window.open(`${API_BASE}/license/download/${encodeURIComponent(licenseId)}`, "_blank", "noopener");
  }

  async function extendLicense(licenseId) {
    const row = state.licenses.find((item) => item.license_id === licenseId);
    if (!row) return;
    const mode = window.prompt("输入延期天数，或直接输入新的到期日 YYYY-MM-DD。", "30");
    if (mode === null) return;
    const payload = {
      is_active: true,
      revoked: false,
      approval_status: row.approval_status || "auto",
    };
    if (/^\d{4}-\d{2}-\d{2}$/.test(mode.trim())) {
      payload.expires_at = mode.trim();
    } else {
      const days = Number(mode);
      if (!Number.isFinite(days) || days <= 0) {
        setMessage("延期天数必须大于 0，或输入 YYYY-MM-DD 格式到期日。", "warn");
        return;
      }
      payload.extend_days = days;
    }
    const machine = window.prompt("机器码。如不调整请保持原值。", row.machine_fingerprint || "");
    if (machine === null) return;
    payload.machine_fingerprint = machine.trim();
    await runAdminAction("正在更新并重新签名授权...", async () => {
      await apiPut(`${ADMIN_PATH}/licenses/${encodeURIComponent(licenseId)}`, payload);
      await loadLicenses();
      renderLicenses();
      renderMetrics();
      setMessage("授权已更新并重新签名。客户端在线校验或重新下载授权文件后生效。", "success");
    });
  }

  async function revokeLicense(licenseId) {
    if (!window.confirm(`确认撤销授权 ${licenseId}？`)) return;
    await runAdminAction("正在撤销授权...", async () => {
      await apiDelete(`${ADMIN_PATH}/licenses/${encodeURIComponent(licenseId)}`);
      await loadLicenses();
      renderLicenses();
      renderMetrics();
      setMessage("授权已撤销。", "success");
    });
  }

  async function forceDeleteLicense(licenseId) {
    const confirmation = window.prompt(`硬删除会删除授权记录 ${licenseId}、校验日志和使用上报。仅用于清理测试数据。\n请输入 DELETE_TEST_RECORDS 确认。`);
    if (confirmation !== "DELETE_TEST_RECORDS") {
      setMessage("已取消硬删除。", "warn");
      return;
    }
    await runAdminAction("正在硬删除测试授权记录...", async () => {
      await apiDelete(`${ADMIN_PATH}/licenses/${encodeURIComponent(licenseId)}?force=1&confirm=DELETE_TEST_RECORDS`);
      await refreshAll();
      setMessage(`测试授权记录已硬删除：${licenseId}`, "success");
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
      renderLicenses();
      renderMetrics();
      setMessage("授权已恢复。", "success");
    });
  }

  function renderMetrics() {
    const overview = state.overview;
    if (overview) {
      const customers = overview.customers || {};
      const users = overview.users || {};
      const licensedUsers = overview.licensed_users || {};
      const site = overview.site || {};
      const codes = overview.activation_codes || {};
      const licenses = overview.licenses || {};
      const releases = overview.releases || {};

      els.metricCustomers.textContent = String(customers.total || 0);
      els.metricCustomersMeta.textContent = `今日 +${customers.created_today || 0} / ${customers.active || 0} 活跃`;
      els.metricUsers.textContent = String(users.total || 0);
      els.metricUsersMeta.textContent = `今日 +${users.registered_today || 0} 注册`;
      els.metricLicensedUsers.textContent = String(licensedUsers.total || 0);
      els.metricLicensedUsersMeta.textContent = `今日 +${licensedUsers.bound_today || 0} / ${licensedUsers.valid || 0} 有效`;
      els.metricVisits.textContent = String(site.visits_total || 0);
      els.metricVisitsMeta.textContent = `今日 +${site.visits_today || 0} / UV ${site.unique_visitors_today || 0}`;
      els.metricCodes.textContent = String(codes.total || 0);
      els.metricCodesMeta.textContent = `今日 +${codes.created_today || 0} / ${codes.active || 0} 可用`;
      els.metricLicenses.textContent = String(licenses.total || 0);
      els.metricLicensesMeta.textContent = `今日 +${licenses.issued_today || 0} / ${licenses.active || 0} 有效`;
      els.metricReleases.textContent = String(releases.total || 0);
      els.metricReleasesMeta.textContent = `今日 +${releases.released_today || 0} 发布`;
      if (state.signingHealth) {
        els.metricApi.textContent = state.signingHealth.ok ? "签名正常" : "签名异常";
      }
      return;
    }

    const customers = visibleRows(state.customers);
    const codes = visibleRows(state.codes);
    const licenses = visibleRows(state.licenses);
    const releases = state.releases;
    els.metricCustomers.textContent = String(customers.length);
    els.metricCustomersMeta.textContent = `${countBy(customers, "active")} 活跃 / ${countBy(customers, "cancelled")} 归档`;
    if (state.overview && state.overview.users) {
      els.metricUsers.textContent = String(state.overview.users.total || 0);
      els.metricUsersMeta.textContent = `今日 +${state.overview.users.registered_24h || 0}`;
    }
    if (state.overview && state.overview.licensed_users) {
      els.metricLicensedUsers.textContent = String(state.overview.licensed_users.valid || 0);
      els.metricLicensedUsersMeta.textContent = `累计绑定 ${state.overview.licensed_users.total || 0}`;
    }
    if (state.overview && state.overview.site) {
      els.metricVisits.textContent = String(state.overview.site.visits_24h || 0);
      els.metricVisitsMeta.textContent = `独立访客 ${state.overview.site.unique_visitors_24h || 0}`;
    }
    els.metricCodes.textContent = String(codes.length);
    els.metricCodesMeta.textContent = `${countBy(codes, "active")} 可用 / ${countBy(codes, "used")} 已用`;
    els.metricLicenses.textContent = String(licenses.length);
    els.metricLicensesMeta.textContent = `${licenses.filter((row) => Number(row.is_active) && !Number(row.revoked)).length} 有效`;
    els.metricReleases.textContent = String(releases.length);
    els.metricReleasesMeta.textContent = releases[0] ? `最新 ${releases[0].version || "-"}` : "暂无发行";
    if (state.signingHealth) {
      els.metricApi.textContent = state.signingHealth.ok ? "签名正常" : "签名异常";
    }
  }

  function switchTab(tab) {
    state.currentTab = tab || "customers";
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminTab === state.currentTab);
    });
    els.customerTableToolbar.classList.toggle("hidden", state.currentTab !== "customers");
    els.customersTable.classList.toggle("hidden", state.currentTab !== "customers");
    els.codesTable.classList.toggle("hidden", state.currentTab !== "codes");
    els.licensesTable.classList.toggle("hidden", state.currentTab !== "licenses");
    els.releasesTable.classList.toggle("hidden", state.currentTab !== "releases");
    els.auditTable.classList.toggle("hidden", state.currentTab !== "audit");
    els.usageTable.classList.toggle("hidden", state.currentTab !== "usage");
    els.analysisTable.classList.toggle("hidden", state.currentTab !== "analysis");
  }

  async function runAdminAction(label, action) {
    try {
      setMessage(label, "loading");
      await action();
    } catch (error) {
      setMessage(error.message || String(error), "error");
    }
  }

  async function apiGet(path) {
    return request(path, { method: "GET" });
  }

  async function apiPost(path, body) {
    return request(path, { method: "POST", body });
  }

  async function apiPut(path, body) {
    return request(path, { method: "PUT", body });
  }

  async function apiDelete(path) {
    return request(path, { method: "DELETE" });
  }

  async function request(path, options = {}) {
    if (!state.token) throw new Error("缺少 Admin Token。");
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json",
        "x-admin-token": state.token,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const data = text ? parseJson(text) : {};
    if (!response.ok) {
      throw new Error(errorLabel(data.error || response.statusText));
    }
    return data;
  }

  function formPayload(form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
      data[key] = typeof value === "string" ? value.trim() : value;
    });
    form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      data[input.name] = input.checked;
    });
    return data;
  }

  function tableHtml(headers, rows) {
    return `
      <div class="admin-table-scroll">
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function renderTable(target, headers, rows) {
    if (!rows.length) {
      target.innerHTML = '<div class="empty-state">暂无记录。</div>';
      return;
    }
    target.innerHTML = tableHtml(headers, rows.map((row) => row.map((cell) => escapeHtml(cell))));
  }

  function listPayload(data, legacyKey) {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data[legacyKey])) return data[legacyKey];
    return [];
  }

  function visibleRows(rows) {
    return state.showTestRecords ? rows : rows.filter((row) => !isTestRecord(row));
  }

  function isTestRecord(row) {
    const fields = [
      row.code,
      row.activation_code,
      row.license_id,
      row.customer_name,
      row.customer_email,
      row.email,
      row.username,
      row.machine_fingerprint,
      row.machine_fingerprint_prebind,
      row.notes,
    ].join(" ").toLowerCase();
    return fields.includes("cf-test") || fields.includes("@example.com") || /\+cf\d*@/.test(fields);
  }

  function renderStatus(connected) {
    const signingOk = Boolean(state.signingHealth && state.signingHealth.ok);
    const signingText = connected
      ? (signingOk
        ? `API 已连接，签名密钥正常，公钥指纹 ${shortText(state.signingHealth.public_key_fingerprint || "-", 18)}`
        : "API 已连接，但签名密钥异常，请检查 STOCK_SIGNING_PRIVATE_KEY")
      : "输入 Admin Token 后读取数据";
    els.adminStatus.innerHTML = connected
      ? `<span class="badge-dot ${signingOk ? "ok" : "warn"}"></span><div><strong>${signingOk ? "签名正常" : "签名异常"}</strong><small>${escapeHtml(signingText)}</small></div>`
      : '<span class="badge-dot"></span><div><strong>未连接</strong><small>输入 Admin Token 后读取数据</small></div>';
    els.metricApi.textContent = connected ? (signingOk ? "签名正常" : "签名异常") : "未连接";
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
    clearStoredToken();
    showLogin();
    setLoginMessage(message || "", message ? "success" : "");
    renderStatus(false);
    renderAllTables();
    renderMetrics();
  }

  function clearStoredToken() {
    sessionStorage.removeItem(TOKEN_KEY);
    state.token = "";
    els.adminToken.value = "";
    els.adminLoginToken.value = "";
  }

  function setMessage(message, type) {
    els.adminMessage.textContent = message || "";
    els.adminMessage.className = `admin-message ${type || ""}`;
  }

  function setLoginMessage(message, type) {
    els.loginMessage.textContent = message || "";
    els.loginMessage.className = `admin-message ${type || ""}`;
  }

  function countBy(rows, status) {
    return rows.filter((row) => row.status === status).length;
  }

  function statusLabel(value) {
    return {
      active: "可用",
      assigned: "已分配",
      used: "已使用",
      suspended: "暂停",
      revoked: "已撤销",
    }[value] || value || "-";
  }

  function customerStatusLabel(value) {
    return {
      draft: "草稿",
      active: "活跃",
      issued: "已交付",
      suspended: "暂停",
      cancelled: "取消",
    }[value] || value || "-";
  }

  function errorLabel(value) {
    return {
      unauthorized: "管理员 Token 无效或已过期。",
      not_found: "当前 API 版本还没有部署对应接口，请先重新部署 Cloudflare Worker。",
      customer_has_activation_codes: "该客户已有授权码或授权记录，已改为归档处理。",
      used_activation_code_cannot_be_deleted_revoke_license_instead: "已使用授权码不能删除，请撤销对应授权记录。",
      used_activation_code_status_locked: "已使用授权码状态不能回退。",
      license_not_found: "未找到授权记录。",
      activation_code_not_found: "未找到授权码。",
    }[value] || value || "操作失败";
  }

  function promptNumber(message, fallback) {
    const value = window.prompt(message, String(fallback || ""));
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMessage("请输入大于 0 的数字。", "warn");
      return null;
    }
    return parsed;
  }

  function formatDate(value) {
    if (!value) return "-";
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function shortText(value, length) {
    const text = String(value || "");
    return text.length > length ? `${text.slice(0, length - 1)}...` : text;
  }
  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return "-";
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  async function copyText(text) {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(String(text || ""));
      return;
    }
    const input = document.createElement("textarea");
    input.value = String(text || "");
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  function byId(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing element: ${id}`);
    return element;
  }
})();
