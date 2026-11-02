(function () {
  "use strict";
  const {t, escape, icon, icons, edition, date, errorText, empty} = window.ScorpioAccountViews;
  const byId = (id) => document.getElementById(id);
  const views = {customers: ["客户交付", "Customer delivery"], codes: ["授权码库存", "Code inventory"], releases: ["客户端发行", "Client releases"], logs: ["记录与维护", "Records & diagnostics"]};
  let config, root, current = "customers", logView = "audit", editingRelease = null, busy = false, loaded = false;
  const offsets = {}, dialogs = {};
  let resolveInput = null;
  function input({title, copy, fields = "", label = t("确认", "Confirm")}) {
    const form = byId("deliveryInputForm");
    byId("deliveryEditorTitle-input").textContent = title;
    byId("deliveryInputCopy").textContent = copy;
    byId("deliveryInputFields").innerHTML = fields;
    form.querySelector('[type="submit"]').textContent = label;
    return new Promise((resolve) => { resolveInput?.(null); resolveInput = resolve; open("input"); });
  }
  function localizeForms() {
    const labels = {customer_name: ["客户名称", "Customer name"], customer_email: ["客户邮箱", "Customer email"], email: ["客户邮箱", "Customer email"], edition: ["授权版本", "License edition"], license_days: ["有效天数", "License days"], status: ["客户状态", "Customer status"], machine_fingerprint_prebind: ["预绑定设备（选填）", "Pre-bound device (optional)"], notes: ["交付备注", "Delivery notes"], customer_id: ["关联客户", "Customer"], count: ["授权码数量", "Code quantity"], max_devices: ["每个平台设备数", "Devices per platform"], version: ["软件版本号", "Software version"], channel: ["发行通道", "Release channel"], platform: ["客户端平台", "Client platform"], r2_key: ["安装包 R2 对象 Key", "Package R2 object key"], file_name: ["安装包文件名", "Package filename"], content_type: ["文件类型", "Content type"], download_url: ["备用 HTTPS 地址", "Alternative HTTPS URL"], hk_download_url: ["香港 CDN 地址", "Hong Kong CDN URL"], file_hash_sha256: ["SHA256 校验值（选填）", "SHA256 checksum (optional)"], file_size_bytes: ["文件字节数", "File bytes"], is_required: ["要求客户端更新", "Require clients to update"], release_notes: ["发行说明", "Release notes"]};
    for (const form of [byId("customerForm"), byId("codeForm"), byId("releaseForm")]) {
      for (const field of form.elements) {
        const label = field.closest("label"); if (!label || !labels[field.name]) continue;
        const node = [...label.childNodes].find((item) => item.nodeType === Node.TEXT_NODE && item.nodeValue.trim()); if (node) node.nodeValue = t(...labels[field.name]);
      }
      for (const option of form.querySelectorAll("select[name=edition] option")) option.textContent = option.value === "all" ? t("所有授权版本", "All editions") : edition(option.value);
      for (const option of form.querySelectorAll("select[name=platform] option")) option.textContent = option.value === "android" ? "Android" : "Windows";
      for (const option of form.querySelectorAll("select[name=channel] option")) option.textContent = option.value === "beta" ? t("测试通道 Beta", "Beta") : t("正式通道 Stable", "Stable");
    }
    byId("customerSubmitButton").textContent = t(byId("customerId").value ? "更新客户" : "保存客户", byId("customerId").value ? "Update customer" : "Save customer");
    byId("codeForm").querySelector('button[type="submit"]').textContent = t("生成授权码", "Generate codes"); byId("releaseForm").querySelector('button[type="submit"]').textContent = t("校验并发布", "Validate & publish"); byId("clearCustomerFormButton").textContent = t("重置", "Reset");
  }
  function activeTable() { return current === "logs" ? logView : current; }
  function setMessage(message, type = "success") { const node = byId("adminMessage"); node.textContent = message; node.className = `admin-message portal-notice ${type}`; }
  function select(view, fetch = true) {
    current = view in views ? view : "customers";
    root.querySelectorAll("[data-delivery-view]").forEach((button) => { const active = button.dataset.deliveryView === current; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
    root.querySelectorAll("[data-delivery-panel]").forEach((panel) => { panel.hidden = panel.dataset.deliveryPanel !== current; });
    byId("deliveryCreate").hidden = current === "logs";
    byId("deliveryCreate").innerHTML = `${icon("plus")}${current === "customers" ? t("新增客户", "New customer") : current === "codes" ? t("生成授权码", "Generate codes") : t("新增发行", "New release")}`;
    byId("deliverySearch").hidden = current === "customers"; byId("deliveryPlatform").hidden = current !== "releases";
    byId("deliveryStatus").hidden = !["codes", "releases"].includes(current);
    if (["codes", "releases"].includes(current)) {
      const value = byId("deliveryStatus").value, states = current === "releases" ? {active: ["已发布", "Published"], inactive: ["已下架", "Unpublished"]} : {active: ["可用", "Available"], assigned: ["已分配", "Assigned"], used: ["已使用", "Used"], revoked: ["已撤销", "Revoked"], suspended: ["已暂停", "Paused"]};
      byId("deliveryStatus").innerHTML = `<option value="">${t("全部状态", "All states")}</option>` + Object.entries(states).map(([key, name]) => `<option value="${key}">${t(...name)}</option>`).join("");
      if (value in states) byId("deliveryStatus").value = value;
    }
    config.changeTab(activeTable()); icons();
    root.querySelectorAll("[data-delivery-log]").forEach((button) => button.classList.toggle("active", button.dataset.deliveryLog === logView));
    if (fetch) refresh(); else render();
  }
  async function refresh() {
    if (busy) return;
    byId("deliveryRefresh").disabled = true;
    try { await config.refresh(activeTable()); loaded = true; render(); }
    catch (error) { setMessage(errorText(error), "error"); }
    finally { byId("deliveryRefresh").disabled = false; }
  }
  function makeEditor(kind, title, form) {
    const dialog = document.createElement("dialog"); dialog.className = "delivery-editor portal-admin"; dialog.id = `deliveryEditor-${kind}`; dialog.setAttribute("aria-labelledby", `deliveryEditorTitle-${kind}`);
    dialog.innerHTML = `<header><h2 id="deliveryEditorTitle-${kind}">${title}</h2><button type="button" class="portal-icon" data-delivery-close title="${t("关闭", "Close")}" aria-label="${t("关闭", "Close")}">${icon("x")}</button></header>`;
    const message = document.createElement("p"); message.className = "portal-notice hidden"; message.dataset.deliveryEditorMessage = ""; message.setAttribute("role", "status"); dialog.append(message);
    if (form) {
      dialog.append(form);
      let actions = form.querySelector(".form-actions");
      if (!actions) { actions = document.createElement("div"); actions.className = "form-actions wide"; form.querySelectorAll('button[type="submit"]').forEach((button) => actions.append(button)); form.append(actions); }
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "button secondary"; cancel.dataset.deliveryClose = ""; cancel.textContent = t("取消", "Cancel"); actions.prepend(cancel);
    }
    document.body.append(dialog); dialogs[kind] = dialog;
    dialog.addEventListener("click", (event) => { if (event.target.closest("[data-delivery-close]") && !busy) dialog.close(); });
    dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    return dialog;
  }
  function open(kind) {
    const dialog = dialogs[kind]; if (!dialog) return;
    localizeForms(); dialog.querySelector("[data-delivery-editor-message]").classList.add("hidden"); dialog.showModal(); icons(); dialog.querySelector('input:not([type="hidden"]),select,textarea')?.focus();
  }
  function newCustomer() { config.clearCustomer(); open("customer"); }
  function newCode(customerId) {
    const form = byId("codeForm"); form.reset(); byId("generatedCodes").classList.add("hidden");
    const customer = config.snapshot().customers.find((item) => Number(item.id) === Number(customerId));
    if (customer) { form.elements.customer_id.value = String(customer.id); form.elements.email.value = customer.customer_email || ""; form.elements.customer_name.value = customer.customer_name || ""; form.elements.edition.value = customer.edition || "personal_pro"; form.elements.license_days.value = customer.license_days || 365; }
    open("code");
  }
  function releaseEditor(row) {
    const form = byId("releaseForm"); form.reset(); editingRelease = row || null;
    for (const field of form.elements) if (field.name && row && row[field.name] !== undefined) { if (field.type === "checkbox") field.checked = Boolean(Number(row[field.name])); else field.value = row[field.name] ?? ""; }
    for (const name of ["version", "platform", "edition", "channel"]) form.elements[name].disabled = Boolean(row);
    byId("deliveryEditorTitle-release").textContent = row ? t("编辑发行记录", "Edit release") : t("发布客户端", "Publish client");
    byId("deliveryReleaseCheck").textContent = ""; open("release");
  }
  function info(row) {
    const panel = byId("deliveryReleaseDetail");
    panel.innerHTML = `<dl class="delivery-detail-grid">${[[t("版本", "Version"), row.version], [t("平台", "Platform"), row.platform === "android" ? "Android" : "Windows"], [t("授权版本", "Edition"), edition(row.edition)], [t("通道", "Channel"), row.channel], [t("发布时间", "Released"), date(row.released_at, true)], [t("文件名", "File"), row.file_name], [t("R2 对象", "R2 object"), row.r2_key || "--"], ["SHA256", row.file_hash_sha256 || "--"], [t("发行说明", "Release notes"), row.release_notes || "--"]].map(([label, value]) => `<dt>${label}</dt><dd>${escape(value)}</dd>`).join("")}</dl>`;
    open("detail");
  }
  function confirmDisable(row) {
    const form = byId("deliveryConfirmForm"); form.reset();
    const disabling = Boolean(Number(row.is_active));
    byId("deliveryConfirmCopy").textContent = t(`确认下架 ${row.platform === "android" ? "Android" : "Windows"} v${row.version}？客户端将不再将此记录作为可用安装包，已上传文件和历史下载记录保留。`, `Unpublish ${row.platform === "android" ? "Android" : "Windows"} v${row.version}? It will no longer be offered as an available package. Uploaded files and download history are retained.`);
    if (!disabling) byId("deliveryConfirmCopy").textContent = t(`确认重新发布 v${row.version}？原安装包核对通过后，将重新开放给匹配的客户端。`, `Republish v${row.version}? The original package will be checked before it is offered to matching clients again.`);
    byId("deliveryEditorTitle-confirm").textContent = disabling ? t("下架发行记录", "Unpublish release") : t("重新发布", "Republish release");
    form.querySelector('button[type="submit"]').textContent = disabling ? t("确认下架", "Unpublish") : t("确认重新发布", "Republish");
    byId("deliveryConfirmError").textContent = "";
    form.onsubmit = async (event) => {
      event.preventDefault(); if (busy) return; setBusy(true);
      try {
        if (disabling) await config.request(`/scorpio_v1_admin/releases/${row.id}`, {method: "DELETE"});
        else { const payload = {...row, is_active: 1, require_validation: true}; const check = await config.request("/scorpio_v1_admin/releases/preflight", {method: "POST", body: payload}); payload.r2_etag = check.etag; await config.request("/scorpio_v1_admin/releases", {method: "POST", body: payload}); }
        dialogs.confirm.close(); await config.refresh("releases"); render(); setMessage(disabling ? t("发行记录已下架，原文件保留。", "Release unpublished. The original file is retained.") : t("安装包已重新发布。", "Package republished."));
      }
      catch (error) { byId("deliveryConfirmError").textContent = errorText(error); }
      finally { setBusy(false); }
    }; open("confirm");
  }
  function render() {
    if (!config) return;
    const snapshot = config.snapshot();
    const page = snapshot.pages?.[activeTable()] || {offset: 0, limit: 25, total: snapshot[activeTable()]?.length || 0, has_more: false};
    byId("deliveryPageInfo").textContent = page.total ? `${page.offset + 1}-${Math.min(page.offset + page.limit, page.total)} / ${page.total}` : t("0 条记录", "0 records");
    byId("deliveryPrevious").disabled = !page.offset; byId("deliveryNext").disabled = !page.has_more;
    if (current === "releases") {
      byId("releasesTable").innerHTML = snapshot.releases.length ? `<table><thead><tr>${[t("客户端版本", "Client version"), t("授权与通道", "Edition & channel"), t("安装包", "Package"), t("发布状态", "Status"), t("下载", "Downloads"), t("操作", "Actions")].map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${snapshot.releases.map((row) => `<tr><td><strong>v${escape(row.version)}</strong><small>${row.platform === "android" ? "Android" : "Windows"} · ${date(row.released_at)}</small></td><td>${escape(edition(row.edition))}<small>${escape(row.channel)}</small></td><td>${escape(row.file_name || "--")}<small>${row.file_size_bytes ? (row.file_size_bytes / 1048576).toFixed(1) + " MB" : "--"} · ${row.r2_key ? "R2" : "HTTPS"}</small></td><td><span class="portal-badge ${Number(row.is_active) ? "active" : "revoked"}">${Number(row.is_active) ? row.is_required ? t("强制更新", "Required") : t("已发布", "Published") : t("已下架", "Unpublished")}</span></td><td>${Number(row.download_count || 0)}</td><td><div class="table-actions"><button class="text-action" type="button" data-release-command="detail" data-release-id="${row.id}">${t("详情", "Details")}</button><button class="text-action" type="button" data-release-command="edit" data-release-id="${row.id}">${t("编辑", "Edit")}</button>${Number(row.is_active) ? `<button class="text-action danger" type="button" data-release-command="disable" data-release-id="${row.id}">${t("下架", "Unpublish")}</button>` : ""}</div></td></tr>`).join("")}</tbody></table>` : empty("暂无匹配的发行记录", "No matching releases");
    }
    byId("releasesTable").querySelectorAll('[data-release-command="edit"]').forEach((button) => {
      const row = snapshot.releases.find((item) => Number(item.id) === Number(button.dataset.releaseId));
      if (!row || Number(row.is_active) || button.parentElement.querySelector('[data-release-command="disable"]')) return;
      const restore = document.createElement("button"); restore.type = "button"; restore.className = "text-action"; restore.dataset.releaseCommand = "disable"; restore.dataset.releaseId = row.id; restore.textContent = t("重新发布", "Republish"); button.parentElement.append(restore);
    });
    byId("customersTable").querySelectorAll('[data-customer-action="edit"]').forEach((button) => {
      if (button.parentElement.querySelector("[data-deliver-customer]")) return;
      const issue = document.createElement("button"); issue.type = "button"; issue.className = "text-action"; issue.dataset.deliverCustomer = button.dataset.customerId; issue.textContent = t("发放授权码", "Issue codes"); button.parentElement.prepend(issue);
    });
    icons();
  }
  function setBusy(value) { busy = value; for (const dialog of Object.values(dialogs)) { dialog.setAttribute("aria-busy", String(value)); dialog.querySelectorAll("button").forEach((button) => { button.disabled = value; }); } }
  window.ScorpioAdminDelivery = {
    init(options) {
      config = options;
      const source = document.querySelector(".admin-workbench"), metrics = document.querySelector(".admin-metrics");
      const forms = {customer: byId("customerForm"), code: byId("codeForm"), release: byId("releaseForm")};
      const message = byId("adminMessage"), customerFilters = byId("customerTableToolbar"), testToggle = byId("showTestRecordsToggle");
      root = document.createElement("section"); root.id = "adminDeliveryView"; root.dataset.adminLegacy = ""; root.className = "hidden";
      root.innerHTML = `<div class="delivery-summary" id="deliverySummary"></div><nav class="delivery-subnav" role="tablist" aria-label="${t("交付与发行", "Delivery & releases")}">${Object.entries(views).map(([key, title]) => `<button role="tab" type="button" data-delivery-view="${key}">${t(...title)}</button>`).join("")}</nav><div class="delivery-toolbar"><label class="portal-search" id="deliverySearch">${icon("search")}<span class="visually-hidden">${t("搜索记录", "Search records")}</span><input id="deliverySearchInput" type="search" placeholder="${t("搜索版本、邮箱或记录", "Search version, email or record")}"></label><label class="visually-hidden" for="deliveryPlatform">${t("平台", "Platform")}</label><select id="deliveryPlatform"><option value="">${t("全部平台", "All platforms")}</option><option value="desktop">Windows</option><option value="android">Android</option></select><label class="visually-hidden" for="deliveryStatus">${t("状态", "Status")}</label><select id="deliveryStatus"><option value="">${t("全部状态", "All states")}</option><option value="active">${t("有效 / 已发布", "Active / published")}</option><option value="inactive">${t("停用 / 已下架", "Inactive / unpublished")}</option></select><label class="portal-check" id="deliveryTestToggle"></label><button class="button primary" type="button" id="deliveryCreate"></button><button class="portal-icon" type="button" id="deliveryRefresh" title="${t("刷新记录", "Refresh records")}" aria-label="${t("刷新记录", "Refresh records")}">${icon("refresh-cw")}</button></div><div id="deliveryMessageSlot"></div>${Object.keys(views).map((key) => `<section class="delivery-panel" data-delivery-panel="${key}" ${key !== "customers" ? "hidden" : ""}></section>`).join("")}<div class="portal-pagination"><span id="deliveryPageInfo"></span><div><button class="portal-icon" id="deliveryPrevious" type="button" title="${t("上一页", "Previous page")}" aria-label="${t("上一页", "Previous page")}">${icon("chevron-left")}</button><button class="portal-icon" id="deliveryNext" type="button" title="${t("下一页", "Next page")}" aria-label="${t("下一页", "Next page")}">${icon("chevron-right")}</button></div></div>`;
      source.before(root); byId("deliveryMessageSlot").append(message); message.classList.add("portal-notice");
      for (const id of ["metricCustomers", "metricCodes", "metricReleases"]) { const article = byId(id).closest("article"); const cell = document.createElement("div"); while (article.firstChild) cell.append(article.firstChild); byId("deliverySummary").append(cell); }
      testToggle.parentElement.removeChild(testToggle); byId("deliveryTestToggle").append(testToggle, document.createTextNode(t("测试记录", "Test records")));
      const customerPanel = root.querySelector('[data-delivery-panel="customers"]'); customerFilters.className = "delivery-toolbar"; customerPanel.append(customerFilters, byId("customersTable"));
      root.querySelector('[data-delivery-panel="codes"]').append(byId("codesTable")); root.querySelector('[data-delivery-panel="releases"]').append(byId("releasesTable"));
      const logs = root.querySelector('[data-delivery-panel="logs"]'); logs.innerHTML = `<nav class="delivery-tabs" aria-label="${t("记录类型", "Record type")}">${[["audit", "审计日志", "Audit log"], ["usage", "使用上报", "Usage reports"], ["analysis", "分析请求", "Analysis requests"], ["licenses", "历史设备授权", "Device credentials"]].map(([key, cn, en]) => `<button type="button" data-delivery-log="${key}">${t(cn, en)}</button>`).join("")}</nav>`;
      for (const id of ["auditTable", "usageTable", "analysisTable", "licensesTable"]) logs.append(byId(id));
      const diagnostic = document.createElement("details"); diagnostic.className = "delivery-advanced"; diagnostic.innerHTML = `<summary>${t("访问与服务概况", "Traffic & service overview")}</summary>`; metrics.removeAttribute("data-admin-legacy"); metrics.classList.remove("hidden", "admin-metrics"); metrics.classList.add("delivery-diagnostics"); diagnostic.append(metrics); logs.append(diagnostic);
      makeEditor("customer", t("客户信息", "Customer details"), forms.customer); makeEditor("code", t("发放授权码", "Issue license codes"), forms.code).append(byId("generatedCodes")); makeEditor("release", t("发布客户端", "Publish client"), forms.release);
      const detail = makeEditor("detail", t("发行详情", "Release details")); const content = document.createElement("div"); content.id = "deliveryReleaseDetail"; detail.append(content);
      const confirmation = document.createElement("form"); confirmation.id = "deliveryConfirmForm"; confirmation.className = "delivery-confirm"; confirmation.innerHTML = `<p id="deliveryConfirmCopy"></p><p id="deliveryConfirmError" role="alert"></p><div class="form-actions"><button class="button danger" type="submit">${t("确认下架", "Unpublish")}</button></div>`; makeEditor("confirm", t("下架发行记录", "Unpublish release"), confirmation);
      const inputForm = document.createElement("form"); inputForm.id = "deliveryInputForm"; inputForm.className = "delivery-confirm"; inputForm.innerHTML = `<p id="deliveryInputCopy"></p><div id="deliveryInputFields" class="delivery-input-fields"></div><div class="form-actions"><button class="button primary" type="submit">${t("确认", "Confirm")}</button></div>`;
      const inputDialog = makeEditor("input", t("确认变更", "Confirm change"), inputForm);
      inputForm.addEventListener("submit", (event) => { event.preventDefault(); if (!inputForm.reportValidity()) return; const done = resolveInput; resolveInput = null; inputDialog.close(); done?.(Object.fromEntries(new FormData(inputForm))); });
      inputDialog.addEventListener("close", () => { const done = resolveInput; resolveInput = null; done?.(null); });
      const advanced = document.createElement("details"); advanced.className = "delivery-advanced"; advanced.innerHTML = `<summary>${t("备用下载与传输设置", "Alternative download & transport")}</summary><div></div>`;
      for (const name of ["download_url", "hk_download_url", "content_type"]) advanced.querySelector("div").append(forms.release.elements[name].closest("label"));
      forms.release.querySelector(".form-actions").before(advanced);
      const check = document.createElement("p"); check.id = "deliveryReleaseCheck"; check.className = "wide portal-notice"; check.setAttribute("role", "status"); forms.release.querySelector(".form-actions").before(check);
      source.remove();
      localizeForms();
      root.addEventListener("click", (event) => {
        const tab = event.target.closest("[data-delivery-view]"); if (tab) { offsets[activeTable()] = 0; select(tab.dataset.deliveryView); }
        const log = event.target.closest("[data-delivery-log]"); if (log) { logView = log.dataset.deliveryLog; root.querySelectorAll("[data-delivery-log]").forEach((button) => button.classList.toggle("active", button === log)); config.changeTab(logView); refresh(); }
        const customer = event.target.closest("[data-deliver-customer]"); if (customer) newCode(customer.dataset.deliverCustomer);
        const command = event.target.closest("[data-release-command]"); if (command) { const row = config.snapshot().releases.find((item) => Number(item.id) === Number(command.dataset.releaseId)); if (row) ({edit: releaseEditor, detail: info, disable: confirmDisable}[command.dataset.releaseCommand])?.(row); }
      });
      byId("deliveryCreate").onclick = () => current === "customers" ? newCustomer() : current === "codes" ? newCode() : releaseEditor(); byId("deliveryRefresh").onclick = refresh;
      byId("deliveryPrevious").onclick = () => { offsets[activeTable()] = Math.max(0, (offsets[activeTable()] || 0) - 25); refresh(); }; byId("deliveryNext").onclick = () => { offsets[activeTable()] = (offsets[activeTable()] || 0) + 25; refresh(); };
      let searchTimer; for (const id of ["deliverySearchInput", "customerSearch"]) byId(id).addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { offsets[activeTable()] = 0; refresh(); }, 250); });
      for (const id of ["deliveryPlatform", "deliveryStatus", "customerStatusFilter"]) byId(id).addEventListener("change", () => { offsets[activeTable()] = 0; refresh(); });
      select("customers", false);
    },
    query(type) { const params = new URLSearchParams({limit: "25", offset: String(offsets[type] || 0)}); const q = type === "customers" ? byId("customerSearch").value.trim() : byId("deliverySearchInput").value.trim(); if (q) params.set("q", q); if (type === "customers" && byId("customerStatusFilter").value) params.set("status", byId("customerStatusFilter").value); if (type === "releases" && byId("deliveryPlatform").value) params.set("platform", byId("deliveryPlatform").value); if (["codes", "releases"].includes(type) && byId("deliveryStatus").value) params.set("status", byId("deliveryStatus").value); return params.toString(); },
    activate(value) { if (value) select(current, !loaded); }, render, setBusy, input,
    openView(view, log) { if (["audit", "usage", "analysis", "licenses"].includes(log)) logView = log; select(view); },
    openCustomer() { open("customer"); },
    saved(kind) { if (kind !== "code") dialogs[kind].close(); render(); },
    async saveRelease(payload) {
      const fields = byId("releaseForm").elements;
      for (const name of ["version", "platform", "edition", "channel"]) payload[name] = fields[name].value;
      payload.require_validation = true;
      const check = await config.request("/scorpio_v1_admin/releases/preflight", {method: "POST", body: payload});
      payload.r2_etag = check.etag; if (check.file_size_bytes) payload.file_size_bytes = check.file_size_bytes;
      byId("deliveryReleaseCheck").textContent = check.source === "r2" ? t("R2 安装包已核对，正在发布…", "R2 package verified. Publishing…") : t("HTTPS 地址格式已核对，正在发布…", "HTTPS address format checked. Publishing…");
      await config.request(editingRelease ? `/scorpio_v1_admin/releases/${editingRelease.id}` : "/scorpio_v1_admin/releases", {method: editingRelease ? "PUT" : "POST", body: payload});
      editingRelease = null;
    },
    sessionChanged(value) { if (!value) { loaded = false; for (const dialog of Object.values(dialogs)) dialog.close(); byId("generatedCodes").textContent = ""; } },
    message(text, type) { for (const dialog of Object.values(dialogs)) if (dialog.open) { const node = dialog.querySelector("[data-delivery-editor-message]"); node.textContent = text; node.className = `portal-notice ${type || ""}`; } },
  };
})();
