(function () {
  "use strict";
  const en = () => document.documentElement.lang.startsWith("en");
  const t = (cn, english) => en() ? english : cn;
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const icons = () => window.lucide?.createIcons();
  document.addEventListener("DOMContentLoaded", icons, {once: true});
  const edition = (value) => ({personal_pro: t("个人专业版", "Personal Pro"), personal_standard: t("个人标准版", "Personal Standard"), team: t("团队版", "Team"), enterprise: t("企业版", "Enterprise")}[value] || value || "--");
  const statuses = {
    active: ["授权有效", "Active"], trial: ["试用中", "Trial"], expired: ["已到期", "Expired"], revoked: ["已撤销", "Revoked"],
    pending: ["待处理", "Pending"], unactivated: ["待激活", "Ready to activate"], unlicensed: ["尚未授权", "No license"],
    assigned: ["待激活", "Ready to activate"], used: ["已使用", "Redeemed"], suspended: ["已暂停", "Suspended"],
    approved: ["已批准", "Approved"], rejected: ["已拒绝", "Declined"], released: ["已释放", "Released"],
  };
  const status = (value) => statuses[value] ? t(...statuses[value]) : value || "--";
  const badge = (value) => `<span class="portal-badge ${escape(value)}">${escape(status(value))}</span>`;
  const date = (value, clock = false) => {
    if (!value) return "--";
    if (!clock) return String(value).slice(0, 10);
    const stamp = new Date(value);
    return Number.isFinite(stamp.getTime()) ? new Intl.DateTimeFormat(en() ? "en-GB" : "zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(stamp) : String(value);
  };
  const empty = (cn, english) => `<p class="portal-empty">${escape(t(cn, english))}</p>`;
  const kind = (value) => value === "trial" ? t("试用授权", "Trial license") : t("正式授权", "Commercial license");
  function groupLicenses(items) {
    const groups = new Map();
    for (const item of items) {
      const key = item.activation_code || item.license_id;
      const current = groups.get(key);
      if (!current) groups.set(key, {...item, license_ids: [item.license_id]});
      else {
        const ids = [...current.license_ids, item.license_id];
        const rank = (row) => ["active", "pending", "expired", "revoked"].indexOf(row.status);
        const preferred = rank(item) < rank(current) || rank(item) === rank(current) && item.expires_at > current.expires_at;
        groups.set(key, {...(preferred ? item : current), license_ids: ids});
      }
    }
    return [...groups.values()];
  }
  const errors = {
    auth_challenge_required: ["请先完成安全验证。", "Complete security verification first."],
    auth_challenge_failed: ["安全验证已过期或未通过，请重新验证。", "Verification expired or failed. Please verify again."],
    auth_challenge_unavailable: ["安全验证暂不可用，请稍后重试。", "Security verification is unavailable. Please retry later."],
    feedback_not_found: ["问题不存在或不属于当前账号。", "This issue is unavailable for your account."],
    feedback_attachment_not_found: ["截图不存在或无权查看。", "This screenshot is unavailable for your account."],
    invalid_credentials: ["邮箱或密码不正确。", "The email or password is incorrect."],
    email_exists: ["此邮箱已注册，请登录或重置密码。", "This email is already registered. Sign in or reset your password."],
    email_invalid: ["请输入有效的邮箱地址。", "Enter a valid email address."],
    email_not_verified: ["邮箱尚未验证，请先完成邮箱验证。", "Verify your email before signing in."],
    password_too_short: ["密码至少需要 8 个字符。", "Your password must be at least 8 characters."],
    verification_code_required: ["请填写邮箱验证码。", "Enter the email verification code."],
    verification_code_invalid: ["验证码不正确或已使用，请重新获取。", "The code is incorrect or already used. Request a new one."],
    verification_code_expired: ["验证码已过期，请重新获取。", "The verification code has expired. Request a new one."],
    public_rate_limited: ["请求较频繁，请稍后重试。", "Too many requests. Try again later."],
    account_days_invalid: ["请输入 1 至 3660 之间的整数天数。", "Enter a whole number of days between 1 and 3660."],
    account_reason_required: ["请填写处理原因。", "A reason is required."],
    account_request_already_pending: ["此授权已有待处理的续期申请。", "A renewal request is already pending for this license."],
    account_request_already_resolved: ["申请已处理，请刷新列表。", "This request has been processed. Refresh the list."],
    account_license_restore_required: ["授权已撤销，请先联系支持恢复，不能直接延期。", "This license is revoked. Restore it before extending it."],
    account_state_changed_refresh_required: ["授权信息已经变化，请刷新后重试。", "The license changed. Refresh before trying again."],
    account_operation_conflict: ["此操作已发生变化，请关闭窗口后重新操作。", "This operation changed. Close the dialog and try again."],
    account_action_rate_limited: ["操作较频繁，请稍后重试。", "Too many requests. Try again later."],
    activation_code_unavailable: ["授权码不可用、已使用，或不属于当前账号。", "This code is unavailable, already redeemed, or assigned to another account."],
    account_device_not_found: ["设备记录不存在或不属于此用户。", "The device was not found for this user."],
    license_not_found: ["未找到当前账号的授权。", "No matching license was found for this account."],
    account_code_already_activated: ["该授权已被激活，请通过已激活授权管理延期、撤销或恢复。", "This grant is already activated. Manage it through the activated license instead."],
    account_license_not_pending: ["该授权不在待审批状态，请刷新后重试。", "This license is not awaiting approval. Refresh and try again."],
    account_device_limit_invalid: ["设备额度须为 1 至 20 之间的整数。", "Enter a whole device allowance between 1 and 20."],
    account_user_invalid: ["请选择一个注册用户。", "Select a registered user."],
    account_edition_invalid: ["此操作支持个人标准版与个人专业版。", "This operation supports Personal Standard and Personal Pro."],
  };
  const errorText = (error) => {
    const code = error.data?.error || error.code || error.message || "";
    if (errors[code]) return t(...errors[code]);
    if (Number(error.status) === 429 || /rate_limited$/.test(code)) return t("请求较频繁，请稍后重试。", "Too many requests. Please retry later.");
    if (Number(error.status) === 404) return t("账户管理服务尚未更新，原有登录和下载仍可使用。", "The account service needs updating. Existing sign-in and downloads are still available.");
    if (Number(error.status) >= 500) return t("服务暂时不可用，请稍后刷新重试。", "The service is temporarily unavailable. Try again later.");
    return code || t("操作未完成，请重试。", "The operation could not be completed.");
  };
  const expiry = (value, days, serverTime) => {
    const today = (serverTime || new Date().toISOString()).slice(0, 10);
    const current = value && value.slice(0, 10) > today ? value.slice(0, 10) : today;
    const stamp = new Date(`${current}T00:00:00Z`);
    stamp.setUTCDate(stamp.getUTCDate() + Number(days || 0));
    return Number.isFinite(stamp.getTime()) ? stamp.toISOString().slice(0, 10) : "--";
  };
  function licenseCard(item, admin = false) {
    const state = item.status === "active" && item.kind === "trial" ? "trial" : item.status;
    const renew = ["active", "expired"].includes(item.status);
    const buttons = admin
      ? `${item.status === "pending" ? `<button class="button primary" type="button" data-license-command="approve" data-license="${escape(item.license_id)}">${icon("check")}${t("批准授权", "Approve")}</button>` : ""}
         ${renew ? `<button class="button secondary" type="button" data-license-command="extend" data-license="${escape(item.license_id)}">${icon("calendar-plus")}${t("延期", "Extend")}</button>` : ""}
         ${item.status === "active" ? `<button class="portal-icon" type="button" data-download-license="${escape(item.license_id)}" title="${t("下载授权文件", "Download license")}" aria-label="${t("下载授权文件", "Download license")}">${icon("download")}</button>` : ""}
         <button class="button secondary" type="button" data-license-command="${item.status === "revoked" ? "restore" : "revoke"}" data-license="${escape(item.license_id)}">${icon(item.status === "revoked" ? "rotate-ccw" : "ban")}${item.status === "revoked" ? t("恢复授权", "Restore") : t("撤销", "Revoke")}</button>`
      : `${renew ? `<button class="button secondary" type="button" data-renew-license="${escape(item.license_id)}">${icon("calendar-plus")}${t("申请续期", "Request renewal")}</button>` : ""}
         <button class="portal-text-button" type="button" data-go-view="devices">${t("查看设备", "View devices")}${icon("arrow-right")}</button>`;
    return `<article class="portal-license-item">
      <div class="portal-license-top"><span class="portal-license-icon">${icon("badge-check")}</span><div class="portal-license-heading"><h3>${escape(edition(item.edition))}</h3><p>${kind(item.kind)}</p></div>${badge(state)}</div>
      <div class="portal-license-data"><div><span>${t("到期日期", "Expires on")}</span><strong>${escape(date(item.expires_at))}</strong></div><div><span>${t("剩余天数", "Days remaining")}</span><strong>${item.status === "active" ? `${item.days_left} ${t("天", "days")}` : escape(status(item.status))}</strong></div><div><span>${t("设备额度", "Device allowance")}</span><strong>${item.max_devices} ${t("台 / 平台", "per platform")}</strong></div></div>
      <div class="portal-license-actions">${buttons}</div>
      <details class="portal-muted" style="margin-top:12px"><summary>${t("授权详情", "License details")}</summary><p style="overflow-wrap:anywhere">${(item.license_ids || [item.license_id]).map(escape).join("<br>")}</p>${item.revoke_reason ? `<p>${escape(item.revoke_reason)}</p>` : ""}</details>
    </article>`;
  }
  function deviceCard(item, admin = false) {
    return `<article class="portal-device">${icon(item.platform === "desktop" ? "monitor" : "smartphone")}<div><strong>${escape(item.label)}</strong><p>${escape(edition(item.edition))} · ${escape(date(item.last_seen_at, true))}</p><details><summary>${t("绑定详情", "Binding details")}</summary><code>${escape(item.machine_fingerprint)}</code><span>${t("绑定于", "Bound")} ${escape(date(item.created_at))}</span></details>${admin && item.id.startsWith("mobile:") && item.status !== "released" ? `<button type="button" class="portal-text-button" data-release-device="${escape(item.id.slice(7))}">${t("释放绑定", "Release binding")}</button>` : ""}</div>${badge(item.status)}</article>`;
  }
  function activationCard(item) {
    const available = ["active", "assigned"].includes(item.status);
    return `<article class="portal-license-item"><div class="portal-license-top"><span class="portal-license-icon">${icon("ticket")}</span><div class="portal-license-heading"><h3>${escape(edition(item.edition))}</h3><p>${kind(item.kind)} · ${item.license_days} ${t("天", "days")} · ${item.max_devices} ${t("台 / 平台", "per platform")}</p></div>${badge(available ? "unactivated" : item.status)}</div><p class="portal-muted">${available ? t("有效期从客户端首次激活开始计算。", "The license term starts on first client activation.") : t("当前授权暂不可激活，请联系软件支持。", "This grant cannot currently be activated. Contact support.")}</p>
      <div class="portal-code-line"><code>${escape(item.code)}</code>${available ? `<button class="portal-icon" type="button" data-copy="${escape(item.code)}" title="${t("复制授权码", "Copy code")}" aria-label="${t("复制授权码", "Copy code")}">${icon("copy")}</button>` : ""}</div>
      ${available ? `<div class="portal-license-actions"><button type="button" class="button primary" data-go-view="downloads">${icon("download")}${t("下载客户端", "Download client")}</button><button type="button" class="button secondary" data-bind-code="${escape(item.code)}">${icon("key-round")}${t("手动绑定电脑", "Bind a desktop")}</button></div>` : ""}</article>`;
  }
  function eventList(items, limit = Infinity) {
    const operations = new Map();
    for (const item of items) {
      const key = item.operation_id || `event-${item.id}`;
      if (!operations.has(key)) operations.set(key, item);
    }
    items = [...operations.values()].slice(0, limit);
    const names = {grant: ["发放正式授权", "Commercial license assigned"], redeem: ["授权码已绑定账号", "Code linked to account"],
      extend: ["授权已延期", "License extended"], revoke: ["授权已撤销", "License revoked"], restore: ["授权已恢复", "License restored"],
      approve: ["软件授权已批准", "Software license approved"], code_edit: ["待激活授权已调整", "Pending grant updated"], code_suspend: ["授权激活已暂停", "Activation paused"], code_resume: ["授权激活已恢复", "Activation resumed"], code_revoke: ["待激活授权已撤销", "Pending grant revoked"], code_restore: ["待激活授权已恢复", "Pending grant restored"],
      renewal_request: ["已提交续期申请", "Renewal requested"], reject_request: ["续期申请未通过", "Renewal declined"], release_mobile_device: ["设备绑定已释放", "Device binding released"]};
    return items.length ? items.map((item) => `<div class="portal-event">${icon("clock-3")}<div><strong>${escape(names[item.action] ? t(...names[item.action]) : item.action)}</strong><p>${escape(item.reason)}</p>${item.before?.expires_at && item.after?.expires_at && item.before.expires_at !== item.after.expires_at ? `<p>${escape(date(item.before.expires_at))} &rarr; ${escape(date(item.after.expires_at))}</p>` : ""}${item.after?.code && item.after.days ? `<p>${escape(edition(item.after.edition))} · ${item.after.days} ${t("天", "days")} · ${item.after.max_devices || 1} ${t("台 / 平台", "per platform")}</p>` : ""}</div><time datetime="${escape(item.created_at)}">${escape(date(item.created_at, true))}</time></div>`).join("") : empty("暂无授权变更记录", "No license changes yet");
  }
  function requestList(items) {
    return items.length ? items.map((item) => `<div class="portal-event">${icon("calendar-clock")}<div><strong>${t("申请延期", "Renewal request")} ${item.requested_days} ${t("天", "days")} ${badge(item.status)}</strong><p>${escape(item.license_id)}</p>${item.resolution_note ? `<p>${escape(item.resolution_note)}</p>` : ""}</div><time>${escape(date(item.created_at, true))}</time></div>`).join("") : empty("暂无续期申请", "No renewal requests yet");
  }
  function dialog() {
    const node = document.getElementById("portalDialog"), form = document.getElementById("portalDialogForm");
    let submit, busy = false, opener;
    const close = () => { if (!busy) node.close(); };
    document.getElementById("portalDialogClose").addEventListener("click", close);
    document.getElementById("portalDialogCancel").addEventListener("click", close);
    node.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    node.addEventListener("close", () => opener?.focus());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !submit) return;
      busy = true;
      const button = document.getElementById("portalDialogSubmit");
      button.disabled = true;
      const message = document.getElementById("portalDialogError");
      message.classList.add("hidden");
      try { await submit(Object.fromEntries(new FormData(form))); busy = false; node.close(); }
      catch (error) { message.textContent = errorText(error); message.classList.remove("hidden"); }
      finally { busy = false; button.disabled = false; }
    });
    return {
      open(options) {
        opener = document.activeElement;
        document.getElementById("portalDialogTitle").textContent = options.title;
        document.getElementById("portalDialogBody").innerHTML = options.body;
        document.getElementById("portalDialogSubmit").textContent = options.label || t("确认", "Confirm");
        document.getElementById("portalDialogError").classList.add("hidden");
        submit = options.submit;
        if (!node.open) node.showModal();
        icons();
        node.querySelector("input:not([type=hidden]), textarea, select")?.focus();
        options.ready?.(form);
      },
      close() { node.close(); },
    };
  }
  window.ScorpioAccountViews = {t, escape, icon, icons, edition, status, badge, date, empty, kind, errorText, expiry, groupLicenses, licenseCard, deviceCard, eventList, requestList, dialog};

  let options, data, isSignedIn = false, identity = "", revision = 0, modal;
  const byId = (id) => document.getElementById(id);
  const notice = (message, type = "success") => {
    byId("portalNotice").textContent = message;
    byId("portalNotice").className = `portal-notice ${type}`;
  };
  function navigate(view) {
    view = {"license-console": "licenses", "software-download": "downloads"}[view] || view;
    if (!["overview", "licenses", "devices", "history", "downloads", "feedback"].includes(view)) view = "overview";
    document.querySelectorAll("[data-account-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.accountView === view);
      if (button.dataset.accountView === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    document.querySelectorAll("[data-account-section]").forEach((section) => section.classList.toggle("hidden", section.dataset.accountSection !== view));
    byId("portalPageTitle").textContent = {overview: t("账户概览", "Account overview"), licenses: t("我的授权", "My licenses"), devices: t("我的设备", "My devices"), history: t("申请与记录", "Requests & activity"), downloads: t("客户端下载", "Downloads"), feedback: t("我的反馈", "My feedback")}[view];
    window.ScorpioSupportCenter?.navigate(view);
    history.replaceState(null, "", `${location.pathname}${location.search}#${view}`);
  }
  function render() {
    const summary = data.summary;
    byId("portalPlan").textContent = edition(summary.edition);
    byId("portalStatus").textContent = status(summary.status);
    byId("portalGrantType").textContent = ["trial", "active"].includes(summary.status) ? kind(summary.status === "trial" ? "trial" : "commercial") : t("账号权益", "Account entitlement");
    byId("portalExpiry").textContent = date(summary.expires_at);
    byId("portalRemaining").textContent = summary.active_licenses ? `${t("剩余", "Remaining")} ${summary.days_left} ${t("天", "days")}` : status(summary.status);
    byId("portalRenewalStatus").textContent = summary.pending_requests ? `${summary.pending_requests} ${t("项申请待处理", "pending request(s)")}` : t("无待处理申请", "No pending requests");
    byId("portalDeviceCount").textContent = String(summary.active_devices);
    byId("portalPlatformCount").textContent = "Windows / Android";
    const grouped = groupLicenses(data.licenses);
    const active = grouped.filter((item) => item.status === "active");
    const codes = data.activation_codes.filter((item) => !item.activation_count);
    const noLicense = empty("尚未激活软件授权", "No activated software license") + `<div class="portal-license-actions"><button class="button primary" type="button" data-go-view="${data.activation_codes.some((item) => ["active", "assigned"].includes(item.status)) ? "downloads" : "licenses"}">${t("客户端下载与授权", "Downloads & licensing")}${icon("arrow-right")}</button></div>`;
    byId("portalOverviewLicenses").innerHTML = (active.length ? active : grouped).slice(0, 2).map((item) => licenseCard(item)).join("") || codes.slice(0, 2).map(activationCard).join("") || noLicense;
    byId("portalLicenses").innerHTML = grouped.map((item) => licenseCard(item)).join("") || empty("尚未激活软件授权", "No activated software license");
    byId("portalActivationCodes").innerHTML = codes.map(activationCard).join("") || empty("暂无待激活授权", "No pending activations");
    byId("portalDevices").innerHTML = data.devices.map((item) => deviceCard(item)).join("") || empty("暂无设备绑定", "No devices connected");
    byId("portalDeviceSummary").textContent = `${summary.active_devices} ${t("台设备授权有效", "active device(s)")}`;
    byId("portalEvents").innerHTML = eventList(data.events);
    byId("portalRecentEvents").innerHTML = eventList(data.events, 4);
    byId("portalRequests").innerHTML = requestList(data.requests);
    icons();
  }
  async function refresh() {
    if (!isSignedIn || !options) return;
    const sequence = ++revision;
    byId("portalRefresh").disabled = true;
    try {
      const result = await options.request("/account/overview", {auth: true});
      if (sequence !== revision || !isSignedIn) return;
      data = result;
      byId("portalApiError").classList.add("hidden");
      render();
    } catch (error) {
      if (sequence !== revision || !isSignedIn) return;
      byId("portalApiError").textContent = errorText(error);
      byId("portalApiError").classList.remove("hidden");
    } finally { if (sequence === revision) byId("portalRefresh").disabled = false; }
  }
  function renew(licenseId) {
    const license = data?.licenses.find((item) => item.license_id === licenseId);
    if (!license) return;
    const ids = data.licenses.filter((item) => item.license_id === licenseId || license.activation_code && item.activation_code === license.activation_code).map((item) => item.license_id);
    const pending = data.requests.some((item) => ids.includes(item.license_id) && item.status === "pending");
    if (pending) { notice(t("此授权已有待处理的续期申请。", "A renewal request is already pending for this license."), "warn"); return; }
    const groupExpiry = data.licenses.filter((item) => ids.includes(item.license_id) && item.status !== "revoked").reduce((value, item) => item.expires_at > value ? item.expires_at : value, license.expires_at);
    const requestId = crypto.randomUUID();
    modal.open({title: t("申请续期", "Request renewal"), label: t("提交申请", "Submit request"),
      body: `<p class="portal-muted">${escape(edition(license.edition))}</p><label>${t("申请天数", "Requested days")}<input name="requested_days" type="number" min="1" max="3660" step="1" value="30" required></label><div class="portal-change-preview"><div><small>${t("当前到期日", "Current expiry")}</small><strong>${date(license.expires_at)}</strong></div>${icon("arrow-right")}<div><small>${t("批准后预计到期日", "Expected after approval")}</small><strong id="portalRenewalPreview">${expiry(groupExpiry, 30, data.server_time)}</strong></div></div><label>${t("申请备注", "Request note")}<textarea name="note" maxlength="1000" rows="3"></textarea></label>`,
      ready(form) { form.elements.requested_days.addEventListener("input", () => { byId("portalRenewalPreview").textContent = expiry(groupExpiry, form.elements.requested_days.value, data.server_time); }); },
      async submit(fields) {
        await options.request("/account/requests", {method: "POST", auth: true, body: {...fields, requested_days: Number(fields.requested_days), license_id: licenseId, request_id: requestId}});
        await refresh(); navigate("history"); notice(t("续期申请已提交，待处理后生效。", "Renewal request submitted. It takes effect after approval."));
      },
    });
  }
  window.ScorpioAccountCenter = {
    init(config) {
      options = config; modal = dialog();
      document.querySelectorAll("[data-account-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.accountView)));
      byId("accountWorkspace").addEventListener("click", async (event) => {
        const go = event.target.closest("[data-go-view]");
        if (go) navigate(go.dataset.goView);
        const renewal = event.target.closest("[data-renew-license]");
        if (renewal) renew(renewal.dataset.renewLicense);
        const bind = event.target.closest("[data-bind-code]");
        if (bind) {
          navigate("licenses"); options.selectActivationCode(bind.dataset.bindCode);
          byId("portalManualBinding").open = true; byId("machineFingerprint").focus();
        }
        const copy = event.target.closest("[data-copy]");
        if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); notice(t("授权码已复制。", "Code copied.")); } catch { notice(t("无法访问剪贴板。", "Clipboard access is unavailable."), "warn"); } }
      });
      byId("portalRefresh").addEventListener("click", () => { byId("portalNotice").classList.add("hidden"); config.refreshAccount(); });
      byId("portalRedeem").addEventListener("click", () => {
        const requestId = crypto.randomUUID();
        modal.open({title: t("兑换授权码", "Redeem a code"), label: t("绑定到当前账号", "Link to my account"),
          body: `<label>${t("授权码", "License code")}<input name="activation_code" type="text" autocomplete="off" maxlength="128" required></label>`,
          async submit(fields) {
            await config.request("/account/redeem", {method: "POST", auth: true, body: {...fields, request_id: requestId}});
            await config.refreshAccount(); notice(t("授权码已绑定当前账号。", "Code linked to your account."));
          },
        });
      });
      navigate(location.hash.slice(1));
    },
    sessionChanged(signedIn, email) {
      if (!options) return;
      if (identity !== email || signedIn !== isSignedIn) {
        window.ScorpioSupportCenter?.sessionChanged(signedIn);
        ++revision; data = null; modal.close();
        byId("portalNotice").classList.add("hidden"); byId("portalApiError").classList.add("hidden");
        ["portalOverviewLicenses", "portalLicenses", "portalActivationCodes", "portalDevices", "portalEvents", "portalRecentEvents", "portalRequests"].forEach((id) => { byId(id).innerHTML = empty("正在读取...", "Loading..."); });
        ["portalPlan", "portalStatus", "portalExpiry", "portalRemaining", "portalGrantType", "portalDeviceCount", "portalPlatformCount", "portalRenewalStatus"].forEach((id) => { byId(id).textContent = "--"; });
      }
      identity = email; isSignedIn = signedIn;
      byId("accountAuthView").classList.toggle("hidden", signedIn);
      byId("accountWorkspace").classList.toggle("hidden", !signedIn);
      byId("logoutButton").classList.toggle("hidden", !signedIn);
    },
    refresh,
    navigate,
  };
})();
