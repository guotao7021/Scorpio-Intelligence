(function () {
  "use strict";
  const V = window.ScorpioAccountViews;
  const {t, escape, icon, icons, edition, badge, date, empty, errorText} = V;
  const ROOT = "/scorpio_v1_admin";
  const byId = (id) => document.getElementById(id);
  let config, modal, authorized = false, currentUser = null, detail = null, detailView = "licenses";
  let page = {offset: 0, limit: 25, total: 0}, licensePage = {...page}, sequence = 0, detailSequence = 0, licenseSequence = 0, requestSequence = 0;
  const notify = (message, type = "success") => {
    for (const id of ["adminAccountNotice", "adminDetailNotice"]) {
      byId(id).textContent = message; byId(id).className = `portal-notice ${type}`;
    }
  };
  async function call(path, options = {}) {
    try { return await config.request(ROOT + path, options); }
    catch (error) { if (error.status === 403) config.invalidSession(); throw error; }
  }
  function navigate(view) {
    window.ScorpioAdminOverview?.activate(view === "overview");
    byId("adminOverviewView")?.classList.toggle("hidden", view !== "overview");
    byId("adminAccountNotice").classList.add("hidden");
    window.ScorpioSupportCenter?.navigate(view);
    window.ScorpioAdminDelivery?.activate(view === "legacy");
    history.replaceState(null, "", `${location.pathname}${location.search}#${view}`);
    document.querySelector(".admin-command-bar h1").textContent = {licenses: t("用户与软件授权", "Users & software licenses"), users: t("注册用户", "Registered users"), requests: t("续期申请", "Renewal requests"), legacy: t("交付与发行", "Delivery & releases"), feedback: t("问题反馈", "Feedback inbox")}[view] || t("用户与软件授权", "Users & software licenses");
    document.querySelector(".admin-command-bar p:not(.section-kicker)").hidden = view === "feedback";
    if (view === "overview") document.querySelector(".admin-command-bar h1").textContent = t("运营概览", "Operations overview");
    document.querySelectorAll("[data-account-admin-view]").forEach((button) => {
      const selected = button.dataset.accountAdminView === view;
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    byId("adminUsersView").classList.toggle("hidden", view !== "users");
    byId("adminRequestsView").classList.toggle("hidden", view !== "requests");
    byId("adminLicensesView").classList.toggle("hidden", view !== "licenses");
    document.querySelectorAll("[data-admin-legacy]").forEach((node) => node.classList.toggle("hidden", view !== "legacy"));
    if (view === "requests") loadRequests();
    if (view === "users") loadUsers();
    if (view === "licenses") loadLicenses();
  }
  async function loadLicenses() {
    if (!authorized) return;
    const request = ++licenseSequence;
    byId("adminLicensesRefresh").disabled = true;
    try {
      const query = new URLSearchParams({limit: licensePage.limit, offset: licensePage.offset, q: byId("adminLicenseSearch").value.trim(), status: byId("adminLicenseStatus").value, include_test: byId("adminIncludeTestLicenses").checked ? "1" : "0"});
      query.set("archived", byId("adminLicenseArchive").value);
      const data = V.requireContract(await call(`/authorizations?${query}`), (value) => Array.isArray(value?.items) && V.validPage(value.page) && value.counts && typeof value.counts === "object");
      if (request !== licenseSequence || !authorized) return;
      licensePage = data.page;
      const metrics = [["", t("全部授权", "All grants"), Object.values(data.counts).reduce((sum, n) => sum + n, 0)], ["unactivated", t("待激活", "Ready to activate"), data.counts.unactivated || 0], ["active", t("正式授权有效", "Active commercial"), data.counts.active || 0], ["expired", t("已到期", "Expired"), data.counts.expired || 0], ["pending", t("待审批", "Awaiting approval"), data.counts.pending || 0]];
      byId("adminLicenseMetrics").innerHTML = metrics.map(([key, label, count]) => `<button type="button" data-grant-filter="${key}" class="${byId("adminLicenseStatus").value === key ? "selected" : ""}"><span>${label}</span><strong>${count}</strong></button>`).join("");
      byId("adminLicensesTable").innerHTML = data.items.length ? `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>${t("用户 / 授权", "User / grant")}</th><th>${t("版本与类型", "Edition & type")}</th><th>${t("授权状态", "License status")}</th><th>${t("有效期", "Validity")}</th><th class="portal-secondary">${t("设备额度", "Device allowance")}</th><th>${t("操作", "Actions")}</th></tr></thead><tbody>${data.items.map((item) => `<tr><td><strong>${escape(item.username)}</strong><small class="portal-user-email">${escape(item.email)}</small><small class="portal-grant-code">${escape(item.code || item.license_id)}</small></td><td><strong>${escape(edition(item.edition))}</strong><small>${V.kind(item.kind)}</small></td><td>${badge(item.status)}</td><td>${item.license_id ? `<strong>${date(item.expires_at)}</strong><small>${t("到期日期", "Expires on")}</small>` : `<strong>${item.license_days} ${t("天", "days")}</strong><small>${t("首次激活起计时", "Starts on first activation")}</small>`}</td><td class="portal-secondary">${item.max_devices} ${t("台 / 平台", "per platform")}</td><td><button class="portal-text-button" type="button" data-open-user="${item.user_id}" data-focus-grant="${escape(item.code || item.license_id)}">${t("管理授权", "Manage grant")}${icon("arrow-right")}</button></td></tr>`).join("")}</tbody></table></div>` : empty("暂无匹配的用户授权", "No matching account grants");
      byId("adminLicensesPageInfo").textContent = licensePage.total ? `${licensePage.offset + 1}-${Math.min(licensePage.offset + licensePage.limit, licensePage.total)} / ${licensePage.total} ${t("份授权", "grants")}` : t("0 份授权", "0 grants");
      byId("adminLicensesPrevious").disabled = licensePage.offset === 0;
      decorateRecords("adminLicensesTable", data.items, "grant");
      byId("adminLicensesNext").disabled = !licensePage.has_more;
      icons();
    } catch (error) { if (request === licenseSequence) { byId("adminLicensesTable").innerHTML = empty("授权列表未加载", "Grants could not be loaded"); notify(errorText(error), "error"); } }
    finally { if (request === licenseSequence) byId("adminLicensesRefresh").disabled = false; }
  }
  async function loadUsers() {
    if (!authorized) return;
    const request = ++sequence;
    byId("adminUsersRefresh").disabled = true;
    try {
      const query = new URLSearchParams({limit: page.limit, offset: page.offset, q: byId("adminUserSearch").value.trim(), status: byId("adminUserStatus").value, include_test: byId("adminIncludeTestUsers").checked ? "1" : "0"});
      query.set("archived", byId("adminUserArchive").value);
      const data = V.requireContract(await call(`/users?${query}`), (value) => Array.isArray(value?.items) && V.validPage(value.page));
      if (request !== sequence || !authorized) return;
      page = data.page;
      byId("adminUsersTable").innerHTML = data.items.length ? `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>${t("注册用户", "Registered user")}</th><th>${t("授权状态", "License status")}</th><th>${t("版本", "Edition")}</th><th>${t("到期日期", "Expires on")}</th><th class="portal-secondary">${t("注册时间", "Registered")}</th><th>${t("操作", "Actions")}</th></tr></thead><tbody>${data.items.map((user) => `<tr><td><strong>${escape(user.username)}</strong><small class="portal-user-email">${escape(user.email)}</small></td><td>${badge(user.status)}</td><td>${escape(edition(user.edition))}</td><td>${date(user.expires_at)}</td><td class="portal-secondary">${date(user.created_at)}</td><td><button class="portal-text-button" type="button" data-open-user="${user.id}">${t("管理", "Manage")}${icon("arrow-right")}</button></td></tr>`).join("")}</tbody></table></div>` : empty("没有匹配的注册用户", "No users match these filters");
      byId("adminUsersPageInfo").textContent = page.total ? `${page.offset + 1}-${Math.min(page.offset + page.limit, page.total)} / ${page.total} ${t("位用户", "users")}` : t("0 位用户", "0 users");
      byId("adminUsersPrevious").disabled = page.offset === 0;
      decorateRecords("adminUsersTable", data.items, "user");
      byId("adminUsersNext").disabled = !page.has_more;
      icons();
    } catch (error) { if (request === sequence) { byId("adminUsersTable").innerHTML = empty("用户列表未加载", "Users could not be loaded"); notify(errorText(error), "error"); } }
    finally { if (request === sequence) byId("adminUsersRefresh").disabled = false; }
  }
  function decorateRecords(id, items, kind) {
    const table = byId(id); table.recordItems = items;
    const archived = byId(kind === "user" ? "adminUserArchive" : "adminLicenseArchive").value === "1";
    table.querySelectorAll("tbody tr").forEach((row, index) => {
      const cell = row.lastElementChild, item = items[index], actions = document.createElement("div"); actions.className = "operations-row-actions";
      while (cell.firstChild) actions.append(cell.firstChild); cell.append(actions);
      const button = document.createElement("button"); button.type = "button"; button.className = `portal-icon ${archived ? "" : "danger"}`;
      button.dataset.recordKind = kind; button.dataset.recordIndex = index; button.dataset.recordTable = id; button.dataset.recordAction = archived ? "restore" : "archive";
      const blocked = !archived && ["active", "trial", "unactivated", "pending"].includes(item.status);
      const title = blocked ? t("有效授权或待处理记录不能删除", "Active or pending records cannot be deleted") : archived ? t("从回收站恢复", "Restore from recycle bin") : t("删除到回收站", "Move to recycle bin");
      button.title = title; button.ariaLabel = title; button.disabled = blocked; button.innerHTML = icon(archived ? "rotate-ccw" : "trash-2"); actions.append(button);
    });
  }
  function recordAction(button) {
    const kind = button.dataset.recordKind, action = button.dataset.recordAction;
    const item = byId(button.dataset.recordTable).recordItems?.[Number(button.dataset.recordIndex)]; if (!item) return;
    const archive = action === "archive", userId = kind === "user" ? item.id : item.user_id, requestId = crypto.randomUUID();
    modal.open({title: archive ? t("删除到回收站", "Move to recycle bin") : t("恢复记录", "Restore record"), label: archive ? t("确认删除", "Confirm deletion") : t("确认恢复", "Confirm restoration"),
      body: `<p class="portal-muted">${escape(item.email)}${kind === "grant" ? `<br>${escape(item.code || item.license_id)}` : ""}</p><p class="portal-notice ${archive ? "warn" : ""}">${archive ? kind === "user" ? t("账号将停用登录并移入回收站。原授权、反馈和审计记录保留。有有效授权或待处理申请时不能删除。", "The account will be disabled and moved to the recycle bin. Licenses, feedback and audit history are retained. Active grants or pending requests prevent deletion.") : t("整份授权及其设备记录将移入回收站，不删除历史凭证，也不改变到期日期。有效授权不能删除。", "The entire grant and its device records will move to the recycle bin. Evidence and expiry dates are retained. Active grants cannot be deleted.") : t("仅恢复记录。不会发放新试用或增加授权天数。", "Restores the record only. No new trial or license days will be granted.")}</p><label>${t("处理原因", "Reason")}<textarea name="reason" required maxlength="1000" rows="3"></textarea></label>`,
      async submit(fields) {
        await call("/users/record-action", {method: "POST", body: {...fields, kind, action, user_id: userId, code_id: kind === "grant" ? item.code_id : null, license_id: kind === "grant" ? item.license_id || "" : "", request_id: requestId}});
        ++detailSequence; byId("adminUserDrawer").close(); currentUser = null; detail = null; page.offset = 0; licensePage.offset = 0;
        await loadUsers(); await loadLicenses(); notify(archive ? t("记录已移入回收站，历史数据保留。", "Moved to the recycle bin. Historical data is retained.") : t("记录已恢复，原授权期限保持不变。", "Record restored. Original license terms are unchanged."));
      },
    });
  }
  async function loadRequests() {
    if (!authorized) return;
    const request = ++requestSequence;
    try {
      const result = V.requireContract(await call(`/account-requests?status=${encodeURIComponent(byId("adminRequestStatus").value)}`), (value) => Array.isArray(value?.items));
      if (!authorized || request !== requestSequence) return;
      const pending = byId("adminRequestStatus").value === "pending";
      if (pending) byId("adminPendingCount").textContent = result.items.length ? `(${result.items.length})` : "";
      byId("adminRequestsTable").innerHTML = result.items.length ? `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>${t("用户", "User")}</th><th>${t("授权", "License")}</th><th>${t("申请延期", "Requested extension")}</th><th>${t("申请时间", "Requested")}</th><th>${t("操作", "Actions")}</th></tr></thead><tbody>${result.items.map((item) => `<tr><td><strong>${escape(item.username)}</strong><small class="portal-user-email">${escape(item.email)}</small></td><td>${escape(edition(item.edition))}<small>${date(item.expires_at)}</small></td><td>${item.requested_days} ${t("天", "days")}<small>${escape(item.note)}</small></td><td>${date(item.created_at, true)}</td><td>${pending ? `<button type="button" class="portal-text-button" data-resolve-request="${escape(item.public_id)}">${t("处理申请", "Review")}${icon("arrow-right")}</button>` : badge(item.status)}</td></tr>`).join("")}</tbody></table></div>` : empty("暂无此状态的续期申请", "No renewal requests with this status");
      byId("adminRequestsTable").requestItems = result.items;
      icons();
    } catch (error) { if (request === requestSequence) notify(errorText(error), "error"); }
  }
  function codeCard(item) {
    const activated = Number(item.activation_count) > 0;
    const actions = activated ? "" : (item.status === "revoked" ? [["restore", "rotate-ccw", t("恢复授权", "Restore grant")]] : [["edit", "sliders-horizontal", t("调整授权", "Edit grant")], [item.status === "suspended" ? "resume" : "suspend", item.status === "suspended" ? "play" : "pause", item.status === "suspended" ? t("恢复激活", "Resume activation") : t("暂停激活", "Pause activation")], ["revoke", "ban", t("撤销", "Revoke")]])
      .map(([action, symbol, label]) => `<button class="button secondary" type="button" data-code-command="${action}" data-code-id="${item.id}">${icon(symbol)}${label}</button>`).join("");
    return `<article class="portal-license-item" data-grant-key="${escape(item.code)}"><div class="portal-license-top"><span class="portal-license-icon">${icon("ticket")}</span><div class="portal-license-heading"><h3>${escape(edition(item.edition))}</h3><p>${V.kind(item.kind)} · ${t("首次激活起计时", "Starts on first activation")}</p></div>${badge(item.status === "active" ? "unactivated" : item.status)}</div>
      <div class="portal-license-data"><div><span>${t("有效天数", "License days")}</span><strong>${item.license_days} ${t("天", "days")}</strong></div><div><span>${t("设备额度", "Device allowance")}</span><strong>${item.max_devices} ${t("台 / 平台", "per platform")}</strong></div><div><span>${t("发放日期", "Assigned on")}</span><strong>${date(item.created_at)}</strong></div></div><div class="portal-code-line"><code>${escape(item.code)}</code><button class="portal-icon" type="button" data-copy-code="${escape(item.code)}" title="${t("复制授权码", "Copy code")}" aria-label="${t("复制授权码", "Copy code")}">${icon("copy")}</button></div><div class="portal-license-actions">${actions}</div></article>`;
  }
  function selectDetailView(view) {
    detailView = view;
    document.querySelectorAll("[data-user-detail-view]").forEach((button) => { const selected = button.dataset.userDetailView === view; button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; button.classList.toggle("active", selected); });
    document.querySelectorAll("[data-user-detail-section]").forEach((section) => section.classList.toggle("hidden", section.dataset.userDetailSection !== view));
  }
  function renderDetail() {
    const user = detail.user;
    byId("adminUserTitle").textContent = user.username || t("用户详情", "User details");
    byId("adminUserEmail").textContent = user.email;
    byId("adminUserDetail").innerHTML = `<div class="portal-summary"><div><span>${t("授权状态", "License status")}</span><strong>${V.status(detail.summary.status)}</strong><small>${t("当前版本", "Current edition")} ${escape(edition(detail.summary.edition))}</small></div><div><span>${t("注册时间", "Registered")}</span><strong>${date(user.created_at)}</strong><small>${user.email_verified ? t("邮箱已验证", "Email verified") : t("邮箱待验证", "Email not verified")}</small></div></div>
      <div class="portal-detail-tabs" role="tablist" aria-label="${t("用户授权详情", "User authorization details")}">${[["licenses", t("软件授权", "Licenses")], ["devices", t("设备绑定", "Devices")], ["requests", t("续期申请", "Requests")], ["history", t("变更记录", "Activity")]].map(([key, label]) => `<button role="tab" type="button" data-user-detail-view="${key}" aria-controls="adminDetail-${key}">${label}</button>`).join("")}</div>
      <section id="adminDetail-licenses" role="tabpanel" data-user-detail-section="licenses"><div class="portal-section-head"><h3>${t("已激活授权", "Activated licenses")}</h3><button class="button primary" id="adminGrantLicense" type="button">${icon("plus")}${t("发放授权", "Assign license")}</button></div>
      <div class="portal-license-list">${V.groupLicenses(detail.licenses).map((item) => `<div data-grant-key="${escape(item.activation_code || item.license_id)}">${V.licenseCard(item, true)}</div>`).join("") || empty("此用户尚未激活授权", "This user has no activated license")}</div>
      <div class="portal-section-head"><h3>${t("未激活授权", "Unactivated grants")}</h3></div><div class="portal-license-list">${detail.activation_codes.filter((item) => !item.activation_count).map(codeCard).join("") || empty("暂无未激活授权", "No unactivated grants")}</div></section>
      <section id="adminDetail-devices" role="tabpanel" data-user-detail-section="devices"><div class="portal-section-head"><h3>${t("设备与绑定", "Devices & bindings")}</h3><span class="portal-muted">${detail.summary.active_devices} ${t("台有效", "active")}</span></div><div>${detail.devices.map((item) => V.deviceCard(item, true)).join("") || empty("暂无设备绑定", "No devices connected")}</div></section>
      <section id="adminDetail-requests" role="tabpanel" data-user-detail-section="requests"><div class="portal-section-head"><h3>${t("续期申请", "Renewal requests")}</h3></div>${detail.requests.length ? detail.requests.map((item) => `<div>${V.requestList([item])}${item.status === "pending" ? `<button class="portal-text-button" type="button" data-resolve-request="${escape(item.public_id)}">${t("处理申请", "Review request")}${icon("arrow-right")}</button>` : ""}</div>`).join("") : V.requestList([])}</section>
      <section id="adminDetail-history" role="tabpanel" data-user-detail-section="history"><div class="portal-section-head"><h3>${t("授权变更记录", "License history")}</h3></div><div class="portal-timeline">${V.eventList(detail.events)}</div></section>`;
    const archivedKeys = new Set([...detail.licenses.filter((item) => item.archived_at).map((item) => item.activation_code || item.license_id), ...detail.activation_codes.filter((item) => item.archived_at).map((item) => item.code)]);
    if (user.archived_at) {
      byId("adminGrantLicense").hidden = true;
      const note = document.createElement("p"); note.className = "portal-notice warn"; note.textContent = t("此账号已在回收站中。恢复后方可登录或管理授权，历史记录仍可查看。", "This account is in the recycle bin. Restore it before sign-in or license changes. Historical records remain available."); byId("adminUserDetail").prepend(note);
    }
    for (const grant of byId("adminUserDetail").querySelectorAll("[data-grant-key]")) if (user.archived_at || archivedKeys.has(grant.dataset.grantKey)) {
      for (const button of grant.querySelectorAll("[data-license-command],[data-code-command]")) { button.disabled = true; button.title = t("请先从回收站恢复记录", "Restore the record from the recycle bin first"); }
    }
    if (user.archived_at) for (const button of byId("adminUserDetail").querySelectorAll("[data-release-device]")) button.disabled = true;
    selectDetailView(detailView); icons();
  }
  async function openUser(id, focusGrant = "") {
    if (!authorized) return false;
    const request = ++detailSequence;
    if (currentUser !== Number(id) || focusGrant) detailView = "licenses";
    currentUser = Number(id);
    byId("adminUserTitle").textContent = t("用户详情", "User details");
    byId("adminUserEmail").textContent = "";
    byId("adminUserDetail").innerHTML = empty("正在读取用户...", "Loading user...");
    byId("adminDetailNotice").classList.add("hidden");
    if (!byId("adminUserDrawer").open) byId("adminUserDrawer").showModal();
    try {
      const result = await call(`/users/detail?user_id=${encodeURIComponent(id)}`);
      if (request !== detailSequence || !authorized) return false;
      detail = result; renderDetail();
      if (focusGrant) [...byId("adminUserDetail").querySelectorAll("[data-grant-key]")].find((node) => node.dataset.grantKey === focusGrant)?.scrollIntoView({block: "nearest"});
      return true;
    } catch (error) { if (request === detailSequence) { byId("adminUserDetail").innerHTML = empty("用户详情未加载", "User details could not be loaded"); notify(errorText(error), "error"); } return false; }
  }
  async function refreshAfterMutation(message) {
    if (byId("adminUserDrawer").open && currentUser) await openUser(currentUser);
    await loadUsers(); await loadLicenses(); await loadRequests(); notify(message);
    await config.onMutation?.();
  }
  function grant(chooseUser = false) {
    const userId = chooseUser ? null : currentUser, requestId = crypto.randomUUID();
    let searchTimer, pickerSequence = 0;
    modal.open({title: t("发放软件授权", "Assign software license"), label: t("确认发放", "Assign license"),
      body: `${chooseUser ? `<label>${t("搜索注册用户", "Search users")}<input name="user_search" type="search" autocomplete="off" placeholder="${t("邮箱或用户名", "Email or username")}"></label><label>${t("授权用户", "License recipient")}<select name="user_id" required><option value="">${t("正在读取用户...", "Loading users...")}</option></select></label>` : `<p class="portal-muted">${escape(detail.user.email)}</p>`}
        <label>${t("版本", "Edition")}<select name="edition"><option value="personal_pro">${edition("personal_pro")}</option><option value="personal_standard">${edition("personal_standard")}</option></select></label><div class="portal-form-grid"><label>${t("有效天数", "License days")}<input name="days" type="number" min="1" max="3660" step="1" value="365" required></label><label>${t("每个平台设备额度", "Devices per platform")}<input name="max_devices" type="number" min="1" max="20" step="1" value="1" required></label></div>
        <div class="portal-grant-preview"><span>${t("授权生效", "License term")}</span><strong id="adminGrantPreview">${t("首次激活后有效 365 天", "365 days from first activation")}</strong><small>${t("新增独立授权，不改变现有授权的到期日期。", "Creates a separate grant. Existing license expiry dates stay unchanged.")}</small></div><label>${t("处理原因", "Reason")}<textarea name="reason" maxlength="1000" required></textarea></label>`,
      ready(form) {
        form.elements.days.addEventListener("input", () => { byId("adminGrantPreview").textContent = t(`首次激活后有效 ${form.elements.days.value || 0} 天`, `${form.elements.days.value || 0} days from first activation`); });
        if (!chooseUser) return;
        async function findRecipients() {
          const request = ++pickerSequence;
          const select = form.elements.user_id;
          try {
            const result = await call(`/users?limit=25&include_test=1&q=${encodeURIComponent(form.elements.user_search.value.trim())}`);
            if (request !== pickerSequence || !byId("portalDialog").open || !form.elements.user_search) return;
            select.innerHTML = `<option value="">${t("选择授权用户", "Select a recipient")}</option>` + result.items.map((user) => `<option value="${user.id}">${escape(user.username)} · ${escape(user.email)}</option>`).join("");
          } catch (error) { if (request === pickerSequence) { select.innerHTML = `<option value="">${t("用户未加载", "Users could not be loaded")}</option>`; notify(errorText(error), "error"); } }
        }
        form.elements.user_search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(findRecipients, 200); });
        findRecipients();
      },
      async submit(fields) {
        const selectedUser = userId || Number(fields.user_id);
        await call("/users/grant", {method: "POST", body: {...fields, days: Number(fields.days), max_devices: Number(fields.max_devices), user_id: selectedUser, request_id: requestId}});
        if (chooseUser) await openUser(selectedUser);
        await refreshAfterMutation(t("授权已发放，用户下次登录可读取并激活。", "License assigned. The user can activate it on their next sign-in."));
      },
    });
  }
  function codeCommand(id, action) {
    const code = detail?.activation_codes.find((item) => item.id === Number(id));
    if (!code) return;
    const userId = currentUser, requestId = crypto.randomUUID();
    const title = {edit: t("调整待激活授权", "Edit unactivated grant"), suspend: t("暂停授权激活", "Pause activation"), resume: t("恢复授权激活", "Resume activation"), revoke: t("撤销待激活授权", "Revoke unactivated grant"), restore: t("恢复待激活授权", "Restore unactivated grant")}[action];
    const consequence = {suspend: t("暂停后此授权码不可激活，其他授权不受影响。", "This code cannot be activated while paused. Other licenses are unaffected."), resume: t("恢复后用户可继续使用此授权码激活。有效期尚未开始。", "The user can activate this code again. Its license term has not started."), revoke: t("撤销后此授权码不可激活，保留发放与变更记录。", "This code will no longer activate. Its assignment and history are retained."), restore: t("恢复后此授权码重新可用，不增加原有效天数。", "This code becomes available again. Its original term is unchanged.")}[action];
    modal.open({title, label: t("确认变更", "Confirm change"), body: `<p class="portal-muted">${escape(detail.user.email)}<br><code>${escape(code.code)}</code></p>
      ${action === "edit" ? `<label>${t("版本", "Edition")}<select name="edition">${["personal_pro", "personal_standard"].map((value) => `<option value="${value}" ${code.edition === value ? "selected" : ""}>${edition(value)}</option>`).join("")}</select></label><div class="portal-form-grid"><label>${t("有效天数", "License days")}<input name="days" type="number" min="1" max="3660" step="1" value="${code.license_days}" required></label><label>${t("每个平台设备额度", "Devices per platform")}<input name="max_devices" type="number" min="1" max="20" step="1" value="${code.max_devices}" required></label></div><p class="portal-notice">${t("仅调整尚未激活的授权，有效期从首次激活开始。", "Only this unactivated grant changes. Its term starts on first activation.")}</p>` : `<p class="portal-notice ${["suspend", "revoke"].includes(action) ? "warn" : ""}">${consequence}</p>`}
      <label>${t("处理原因", "Reason")}<textarea name="reason" required maxlength="1000"></textarea></label>`,
      async submit(fields) {
        await call("/users/code-action", {method: "POST", body: {...fields, user_id: userId, code_id: code.id, action, days: Number(fields.days || 0), max_devices: Number(fields.max_devices || 0), request_id: requestId}});
        await refreshAfterMutation(t("授权已更新，用户中心刷新后可见。", "Grant updated. The change is visible when the user center refreshes."));
      },
    });
  }
  function licenseCommand(licenseId, action) {
    const license = detail?.licenses.find((item) => item.license_id === licenseId);
    if (!license) return;
    const userId = currentUser, requestId = crypto.randomUUID();
    const grouped = detail.licenses.filter((item) => (item.license_id === licenseId || item.activation_code && item.activation_code === license.activation_code) && (action === "restore" ? item.status === "revoked" : action === "approve" ? item.status === "pending" : item.status !== "revoked"));
    const groupExpiry = (grouped.length ? grouped : [license]).reduce((value, item) => item.expires_at > value ? item.expires_at : value, license.expires_at);
    const title = {extend: t("延长授权", "Extend license"), revoke: t("撤销授权", "Revoke license"), restore: t("恢复授权", "Restore license"), approve: t("批准软件授权", "Approve software license")}[action];
    modal.open({title, label: title,
      body: `<p class="portal-muted">${escape(detail.user.email)} · ${escape(edition(license.edition))}</p>
        ${action === "extend" ? `<label>${t("延期天数", "Additional days")}<input type="number" name="days" min="1" max="3660" step="1" value="30" required></label><div class="portal-change-preview"><div><small>${t("当前到期日", "Current expiry")}</small><strong>${date(groupExpiry)}</strong></div>${icon("arrow-right")}<div><small>${t("延期后到期日", "New expiry")}</small><strong id="adminNewExpiry">${V.expiry(groupExpiry, 30, detail.server_time)}</strong></div></div>` : `<p class="portal-notice ${action === "revoke" ? "warn" : ""}">${action === "revoke" ? t("同一授权下的设备凭证和剩余激活名额一起撤销。已下载的离线凭证在下次在线校验前仍可能有效。", "Device credentials and remaining activation slots are revoked together. Downloaded offline credentials may remain usable until the next online check.") : action === "approve" ? t("批准后关联设备可使用授权，不改变原到期日期。", "Linked devices can use the license after approval. Its expiry is unchanged.") : t("恢复授权不改变原到期日期。已到期授权仍需另行延期。", "Restoring the license does not change its expiry. Expired licenses still require an extension.")}</p>`}
        <p class="portal-muted">${t("影响同一授权下的设备凭证", "Device licenses affected")} ${grouped.length || 1}</p>
        <label>${t("处理原因", "Reason")}<textarea name="reason" maxlength="1000" required></textarea></label>`,
      ready(form) { if (action === "extend") form.elements.days.addEventListener("input", () => { byId("adminNewExpiry").textContent = V.expiry(groupExpiry, form.elements.days.value, detail.server_time); }); },
      async submit(fields) {
        const result = await call("/users/license-action", {method: "POST", body: {...fields, days: Number(fields.days || 0), user_id: userId, license_id: licenseId, action, request_id: requestId}});
        await refreshAfterMutation(action === "extend" ? `${t("云端授权已延期至", "Cloud license extended until")} ${date(result.expires_at)}。${t("客户端刷新授权后生效。", "Clients need to refresh their license.")}` : t("授权状态已更新，等待客户端在线校验。", "License status updated. Clients will receive it on online validation."));
      },
    });
  }
  function resolveRequest(publicId) {
    let item = byId("adminRequestsTable").requestItems?.find((row) => row.public_id === publicId);
    if (byId("adminUserDrawer").open) {
      const request = detail?.requests.find((row) => row.public_id === publicId);
      const license = detail?.licenses.find((row) => row.license_id === request?.license_id);
      if (request) item = {...request, email: detail.user.email, edition: license?.edition, expires_at: license?.expires_at};
    }
    if (!item) return;
    const requestId = crypto.randomUUID();
    modal.open({title: t("处理续期申请", "Review renewal request"), label: t("确认处理", "Confirm decision"),
      body: `<p class="portal-muted">${escape(item.email)} · ${escape(edition(item.edition))}</p><div class="portal-change-preview"><div><small>${t("当前到期日", "Current expiry")}</small><strong>${date(item.expires_at)}</strong></div>${icon("arrow-right")}<div><small>+ ${item.requested_days} ${t("天", "days")}</small><strong>${V.expiry(item.expires_at, item.requested_days)}</strong></div></div><p class="portal-muted">${escape(item.note)}</p><label>${t("处理结果", "Decision")}<select name="decision"><option value="approved">${t("批准并延期", "Approve and extend")}</option><option value="rejected">${t("拒绝申请", "Decline request")}</option></select></label><label>${t("处理原因", "Reason")}<textarea name="reason" required maxlength="1000"></textarea></label>`,
      async submit(fields) { await call("/account-requests/resolve", {method: "POST", body: {...fields, public_id: publicId, request_id: requestId}}); await refreshAfterMutation(t("申请已处理。", "Request processed.")); },
    });
  }
  async function downloadLicense(licenseId) {
    if (!currentUser) return;
    try {
      const result = await call(`/users/license-file?user_id=${currentUser}&license_id=${encodeURIComponent(licenseId)}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.license_file, null, 2)], {type: "application/json"}));
      const link = document.createElement("a"); link.href = url; link.download = "license.json";
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { notify(errorText(error), "error"); }
  }
  function releaseDevice(id) {
    const userId = currentUser, requestId = crypto.randomUUID();
    modal.open({title: t("释放手机绑定", "Release mobile binding"), label: t("确认释放", "Release binding"),
      body: `<p class="portal-notice warn">${t("仅释放此设备的绑定，不撤销软件授权。设备再次登录时可重新申请授权。", "Only this device binding will be released. The software license is unchanged. The device may request authorization again after sign-in.")}</p><label>${t("处理原因", "Reason")}<textarea name="reason" maxlength="1000" required></textarea></label>`,
      async submit(fields) { await call("/users/device-action", {method: "POST", body: {...fields, device_id: Number(id), user_id: userId, request_id: requestId}}); await refreshAfterMutation(t("设备绑定已释放。", "Device binding released.")); },
    });
  }
  function translateShell() {
    if (!document.documentElement.lang.startsWith("en")) return;
    const translations = {"授权管理": "License management", "授权概览": "Grant overview", "搜索用户或授权": "Search users or grants", "搜索邮箱、用户名或授权码": "Search email, username or code", "待审批": "Awaiting approval", "激活暂停": "Activation paused", "发放授权": "Assign license", "刷新授权": "Refresh grants", "用户与软件授权": "Users & software licenses", "注册用户": "Registered users", "搜索注册用户": "Search users", "授权状态": "License status", "全部授权状态": "All license states", "尚未授权": "No license", "待激活": "Ready to activate", "试用中": "Trial", "授权有效": "Active", "已到期": "Expired", "已撤销": "Revoked", "待处理": "Pending", "已批准": "Approved", "已拒绝": "Declined", "续期申请": "Renewal requests", "交付与发行": "Delivery & releases", "显示测试用户": "Include test users", "搜索邮箱或用户名": "Search email or username", "刷新用户": "Refresh users", "刷新申请": "Refresh requests", "上一页": "Previous page", "下一页": "Next page", "关闭": "Close", "取消": "Cancel", "确认": "Confirm", "管理员登录": "Administrator sign-in", "登录后台": "Sign in", "退出登录": "Sign out", "官网首页": "Website", "用户中心": "My account", "运营后台": "Administration"};
    Object.assign(translations, {"运营管理": "Operations", "返回官网": "Back to website", "运营后台导航": "Operations navigation", "记录范围": "Record scope", "正常记录": "Current records", "回收站": "Recycle bin"});
    translations["运营概览"] = "Operations overview";
    Object.assign(translations, {"客户台账": "Customers", "授权码": "License codes", "发行包": "Releases", "搜索客户": "Search customers", "客户名、邮箱、版本或备注": "Name, email, edition or notes", "状态": "Status", "全部状态": "All states", "草稿": "Draft", "活跃": "Active", "已交付": "Delivered", "暂停": "Paused", "取消": "Cancel", "可选": "Optional", "例如 1.0.0": "e.g. 1.0.0", "不关联台账": "No customer record", "绑定 License 用户": "Licensed users", "官网访问": "Site visits", "授权记录": "Device licenses", "Windows 客户端下载": "Windows downloads", "APK 下载": "APK downloads", "API 状态": "API status", "服务端校验": "Server validation"});
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) { const key = node.nodeValue.trim(); if (translations[key]) node.nodeValue = node.nodeValue.replace(key, translations[key]); return; }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches("script,style")) return;
      for (const name of ["placeholder", "title", "aria-label"]) if (translations[node.getAttribute(name)]) node.setAttribute(name, translations[node.getAttribute(name)]);
      node.childNodes.forEach(walk);
    }
    walk(document.body); document.title = "User administration | Scorpio Intelligence";
    document.querySelectorAll(".admin-brand span").forEach((node) => { node.textContent = "License administration"; });
    document.querySelector(".admin-login-note strong").textContent = "Security";
    document.querySelector(".admin-login-note span").textContent = "Account and license data is shown only after your administrator token is verified.";
    byId("adminLoginToken").placeholder = "Administrator token";
    byId("adminLogin").querySelector(".admin-login-copy p:not(.section-kicker)").textContent = "Sign in with your administrator token.";
  }
  window.ScorpioAdminAccounts = {
    init(options) {
      window.ScorpioSupportCenter?.init({...options, admin: true});
      config = options; modal = V.dialog(); translateShell();
      let searchTimer;
      let licenseSearchTimer;
      byId("adminLicenseSearch").addEventListener("input", () => { clearTimeout(licenseSearchTimer); licenseSearchTimer = setTimeout(() => { licensePage.offset = 0; loadLicenses(); }, 250); });
      for (const id of ["adminLicenseStatus", "adminIncludeTestLicenses", "adminLicenseArchive"]) byId(id).addEventListener("change", () => { licensePage.offset = 0; loadLicenses(); });
      byId("adminLicensesRefresh").addEventListener("click", loadLicenses);
      byId("adminLicensesPrevious").addEventListener("click", () => { licensePage.offset = Math.max(0, licensePage.offset - licensePage.limit); loadLicenses(); });
      byId("adminLicensesNext").addEventListener("click", () => { if (licensePage.has_more) { licensePage.offset += licensePage.limit; loadLicenses(); } });
      byId("adminAssignLicense").addEventListener("click", () => grant(true));
      byId("adminLicenseMetrics").addEventListener("click", (event) => { const button = event.target.closest("[data-grant-filter]"); if (button) { byId("adminLicenseStatus").value = button.dataset.grantFilter; licensePage.offset = 0; loadLicenses(); } });
      byId("adminUserSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.offset = 0; loadUsers(); }, 250); });
      for (const id of ["adminUserStatus", "adminIncludeTestUsers", "adminUserArchive"]) byId(id).addEventListener("change", () => { page.offset = 0; loadUsers(); });
      byId("adminConsole").addEventListener("click", (event) => { const button = event.target.closest("[data-record-kind]"); if (button && !button.disabled) recordAction(button); });
      byId("adminUsersRefresh").addEventListener("click", loadUsers);
      byId("adminUsersPrevious").addEventListener("click", () => { page.offset = Math.max(0, page.offset - page.limit); loadUsers(); });
      byId("adminUsersNext").addEventListener("click", () => { if (page.has_more) { page.offset += page.limit; loadUsers(); } });
      byId("adminRequestStatus").addEventListener("change", loadRequests);
      byId("adminRequestsRefresh").addEventListener("click", loadRequests);
      byId("adminUserClose").addEventListener("click", () => byId("adminUserDrawer").close());
      byId("adminUserDetail").addEventListener("keydown", (event) => {
        const tab = event.target.closest("[data-user-detail-view]");
        if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...byId("adminUserDetail").querySelectorAll("[data-user-detail-view]")], index = tabs.indexOf(tab);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        selectDetailView(tabs[next].dataset.userDetailView); tabs[next].focus();
      });
      document.querySelectorAll("[data-account-admin-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.accountAdminView)));
      document.addEventListener("click", async (event) => {
        const user = event.target.closest("[data-open-user]"); if (user) await openUser(user.dataset.openUser, user.dataset.focusGrant);
        const detailTab = event.target.closest("[data-user-detail-view]"); if (detailTab) selectDetailView(detailTab.dataset.userDetailView);
        const command = event.target.closest("[data-license-command]"); if (command) licenseCommand(command.dataset.license, command.dataset.licenseCommand);
        const codeCommandButton = event.target.closest("[data-code-command]"); if (codeCommandButton) codeCommand(codeCommandButton.dataset.codeId, codeCommandButton.dataset.codeCommand);
        const download = event.target.closest("[data-download-license]"); if (download) await downloadLicense(download.dataset.downloadLicense);
        const request = event.target.closest("[data-resolve-request]"); if (request) resolveRequest(request.dataset.resolveRequest);
        const device = event.target.closest("[data-release-device]"); if (device) releaseDevice(device.dataset.releaseDevice);
        if (event.target.closest("#adminGrantLicense")) grant();
        const copy = event.target.closest("[data-copy-code]");
        if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copyCode); notify(t("授权码已复制。", "Code copied.")); } catch { notify(t("剪贴板不可用。", "Clipboard unavailable."), "warn"); } }
      });
      icons();
    },
    sessionChanged(value) {
      const changed = authorized !== value; authorized = value;
      if (changed) window.ScorpioSupportCenter?.sessionChanged(value);
      if (changed) window.ScorpioAdminDelivery?.sessionChanged(value);
      if (changed) window.ScorpioAdminOverview?.sessionChanged(value);
      if (value && changed) { loadUsers(); loadLicenses(); loadRequests(); }
      if (value && changed) navigate(["overview", "licenses", "users", "requests", "legacy", "feedback"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview");
      if (!value) {
        ++sequence; ++detailSequence; ++licenseSequence; ++requestSequence; detail = null; currentUser = null;
        modal.close(); byId("adminUserDrawer").close();
        byId("adminUsersTable").textContent = ""; byId("adminRequestsTable").textContent = ""; byId("adminLicensesTable").textContent = ""; byId("adminLicenseMetrics").textContent = "";
        byId("adminUserDetail").textContent = ""; byId("adminUserEmail").textContent = "";
      }
    },
    navigate(view, status = "") { if (view === "licenses") { byId("adminLicenseStatus").value = status; licensePage.offset = 0; } if (view === "requests" && status) byId("adminRequestStatus").value = status; if (view === "feedback" && byId("supportStatus")) byId("supportStatus").value = ""; navigate(view); },
    viewUser: openUser,
    async editLicense(userId, licenseId, action) { if (await openUser(userId)) licenseCommand(licenseId, action); },
    async editCode(userId, codeId, action) {
      if (!(await openUser(userId))) return;
      const license = detail.licenses.find((item) => item.code_id === Number(codeId));
      if (license && ["revoke", "restore"].includes(action)) licenseCommand(license.license_id, action);
      else if (license) notify(t("该授权已激活，不能再作为待激活授权修改；现有到期日期保持不变。", "This grant is already activated and cannot be edited as an unactivated grant. Its current expiry is unchanged."), "warn");
      else codeCommand(codeId, action);
    },
  };
})();
