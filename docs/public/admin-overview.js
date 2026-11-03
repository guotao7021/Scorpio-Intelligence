(function () {
  "use strict";
  const V = window.ScorpioAccountViews, {t, escape, icon, icons, edition, date, empty, errorText} = V;
  const byId = (id) => document.getElementById(id);
  const fmt = (value) => Number(value || 0).toLocaleString(document.documentElement.lang.startsWith("en") ? "en-GB" : "zh-CN");
  let config, root, data = null, signing = null, authorized = false, active = false, busy = false, timer, revision = 0, days = 7, selectedDay = "";
  const tone = (value) => value ? "warn" : "active";
  function planRefresh() {
    clearTimeout(timer);
    if (authorized && active && !document.hidden && byId("opsAutoRefresh").checked) timer = setTimeout(refresh, 60000);
  }
  async function refresh() {
    if (!authorized || !active || busy) return;
    const request = ++revision; busy = true;
    root.setAttribute("aria-busy", "true"); root.querySelectorAll("[data-ops-days],#opsRefresh").forEach((button) => { button.disabled = true; });
    try {
      const result = V.requireContract(await config.request(`/scorpio_v1_admin/operations?days=${days}`), (value) => value?.period && value.totals && value.snapshot && value.queue && value.analysis && Array.isArray(value.series) && value.series.length === days && ["editions", "pages", "expiring"].every((key) => Array.isArray(value[key])));
      let health = null;
      try { health = await config.request("/scorpio_v1_admin/signing/health"); } catch (error) { if (error.status === 403) throw error; }
      if (!authorized || request !== revision) return;
      data = result; signing = health; root.classList.remove("ops-stale");
      if (!data.series.some((row) => row.day === selectedDay)) selectedDay = data.period.to;
      byId("opsNotice").className = "portal-notice hidden"; render();
    } catch (error) {
      if (request !== revision || !authorized) return;
      if (error.status === 403) { config.invalidSession(); return; }
      root.classList.add("ops-stale");
      for (const id of ["opsApiState", "opsSigningState"]) if (byId(id)) { byId(id).textContent = t("待确认", "Unknown"); byId(id).className = "warn"; }
      byId("opsNotice").textContent = `${errorText(error)}${data ? t(" 已保留上次成功刷新的数据。", " Last successful data is retained.") : ""}`; byId("opsNotice").className = "portal-notice error";
      byId("opsFreshness").textContent = data ? t("刷新失败 · 数据暂未更新", "Refresh failed · data is stale") : t("数据暂不可用", "Data unavailable");
      if (!data) byId("opsBody").innerHTML = empty("运营数据尚未加载", "Operations data has not loaded");
    } finally {
      if (request === revision) { busy = false; root.setAttribute("aria-busy", "false"); root.querySelectorAll("[data-ops-days],#opsRefresh").forEach((button) => { button.disabled = false; }); planRefresh(); }
    }
  }
  function stat(label, value, meta, symbol, className = "") { return `<div class="ops-kpi ${className}"><span>${icon(symbol)}${label}</span><strong>${fmt(value)}</strong><small>${meta}</small></div>`; }
  function route(label, value, view, status = "", level = "") { return `<button class="ops-queue-item ${level}" type="button" data-ops-go="${view}" data-ops-status="${status}"><span>${label}</span><strong>${fmt(value)}</strong>${icon("chevron-right")}</button>`; }
  function bars(label, count, max, className = "") { return `<div class="ops-distribution ${className}"><div><span>${label}</span><strong>${fmt(count)}</strong></div><div class="ops-meter" role="meter" aria-label="${escape(label)}" aria-valuemin="0" aria-valuemax="${Math.max(1, max)}" aria-valuenow="${count}"><span style="width:${max ? Math.min(100, count / max * 100) : 0}%"></span></div></div>`; }
  function renderSelection() {
    if (!data) return;
    const row = data.series.find((item) => item.day === selectedDay) || data.series[data.series.length - 1];
    byId("opsSelectedDay").innerHTML = `<strong>${escape(row.day)}</strong><span>PV <b>${fmt(row.pv)}</b></span><span>UV <b>${fmt(row.uv)}</b></span><span>${t("注册", "Registered")} <b>${fmt(row.registrations)}</b></span><span>${t("下载请求", "Downloads")} <b>${fmt(row.windows + row.android)}</b></span>`;
    root.querySelectorAll("[data-ops-day]").forEach((button) => { const selected = button.dataset.opsDay === row.day; button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected)); });
  }
  function render() {
    const {totals, snapshot: s, queue: q, analysis: a} = data;
    const totalDownloads = totals.windows + totals.android, allDownloads = s.windows_downloads_total + s.android_downloads_total;
    const coverage = s.users ? (s.licensed_users / s.users * 100).toFixed(1) + "%" : "--";
    const max = Math.max(1, ...data.series.map((row) => row.pv));
    byId("opsFreshness").textContent = `${t("更新于", "Updated")} ${date(data.generated_at, true)}`;
    byId("opsRange").textContent = `${data.period.from} — ${data.period.to} · UTC+8`;
    root.querySelectorAll("[data-ops-days]").forEach((button) => { const selected = Number(button.dataset.opsDays) === days; button.classList.toggle("active", selected); button.setAttribute("aria-pressed", String(selected)); });
    byId("opsBody").innerHTML = `<div class="ops-kpi-band">
      ${stat(t("页面访问 PV", "Page views"), totals.pv, `${t("累计记录", "All-time")} ${fmt(s.visits_total)}`, "mouse-pointer-2")}
      ${stat(t("匿名访客 UV", "Unique visitor IDs"), totals.uv, `${t("累计去重", "All-time unique")} ${fmt(s.visitors_total)}`, "scan-face", "teal")}
      ${stat(t("新增注册", "New registrations"), totals.registrations, `${t("当前账号", "Current accounts")} ${fmt(s.users)}`, "user-plus")}
      ${stat(t("客户端下载请求", "Client downloads"), totalDownloads, `${t("累计记录", "All-time")} ${fmt(allDownloads)}`, "download", "gold")}
    </div>
    <div class="ops-main-grid">
      <section class="ops-panel ops-traffic"><header><h2>${t("访问趋势", "Traffic trend")}</h2><div class="ops-legend"><span class="pv">PV</span><span class="uv">UV</span></div></header>
        <div class="ops-chart"><div class="ops-y-axis"><span>${fmt(max)}</span><span>${fmt(max / 2)}</span><span>0</span></div><div class="ops-plot-scroll"><div class="ops-plot" style="--points:${data.series.length}" role="group" aria-label="${t("每日访问趋势", "Daily page views and visitors")}">${data.series.map((row, index) => `<button type="button" class="ops-day" data-ops-day="${row.day}" aria-label="${row.day}, PV ${row.pv}, UV ${row.uv}" title="${row.day} · PV ${fmt(row.pv)} · UV ${fmt(row.uv)}"><span class="ops-day-bars"><i class="pv" style="height:${row.pv / max * 100}%"></i><i class="uv" style="height:${row.uv / max * 100}%"></i></span><small>${data.series.length <= 7 || index === 0 || index === data.series.length - 1 || index % Math.ceil(data.series.length / 7) === 0 ? row.day.slice(5) : ""}</small></button>`).join("")}</div></div></div>
        <div id="opsSelectedDay" class="ops-selected-day"></div>
        <details class="ops-data-table"><summary>${t("每日明细", "Daily records")}</summary><div><table><thead><tr>${[t("日期", "Date"), "PV", "UV", t("注册", "Registrations"), "Windows", "Android"].map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${data.series.map((row) => `<tr><td>${row.day}</td><td>${fmt(row.pv)}</td><td>${fmt(row.uv)}</td><td>${fmt(row.registrations)}</td><td>${fmt(row.windows)}</td><td>${fmt(row.android)}</td></tr>`).join("")}</tbody></table></div></details>
      </section>
      <section class="ops-panel ops-queue"><header><h2>${t("待办与服务", "Queue & service")}</h2><span class="ops-asof">${t("当前", "Current")}</span></header>
        ${route(t("续期申请待审批", "Renewal requests"), q.renewals, "requests", "pending", tone(q.renewals))}
        ${route(t("设备授权待审批", "Device approvals"), q.pending_credentials, "licenses", "pending", tone(q.pending_credentials))}
        ${route(t("待处理问题反馈", "Open feedback"), q.open_feedback, "feedback", "", tone(q.urgent_feedback))}
        <div class="ops-service"><span>${t("授权 API", "License API")}</span><b id="opsApiState" class="active">${t("已连接", "Connected")}</b><span>${t("签名服务", "Signing service")}</span><b id="opsSigningState" class="${signing?.ok ? "active" : "warn"}">${signing?.ok ? t("正常", "Ready") : t("未就绪", "Not ready")}</b></div>
      </section>
    </div>
    <div class="ops-snapshot" aria-label="${t("当前运营资产", "Current operations snapshot")}">
      ${[[t("当前注册用户", "Current accounts"), s.users, "users", ""], [t("有效授权用户", "Licensed users"), s.licensed_users, "licenses", ""], [t("客户台账", "Customers"), s.customers, "customers", ""], [t("授权码库存", "License codes"), s.codes, "codes", t(`可用 ${fmt(s.available_codes)}`, `${fmt(s.available_codes)} available`)], [t("客户端版本", "Client releases"), s.releases, "releases", t(`已发布 ${fmt(s.published_releases)}`, `${fmt(s.published_releases)} published`)], [t("设备授权记录", "Device credentials"), s.credentials, "credentials", t(`有效 ${fmt(s.valid_credentials)}`, `${fmt(s.valid_credentials)} valid`)]].map(([label, count, view, meta]) => `<button type="button" data-ops-go="${view}"><span>${label}</span><strong>${fmt(count)}</strong><small>${meta || "&nbsp;"}</small>${icon("arrow-up-right")}</button>`).join("")}
    </div>
    <div class="ops-detail-grid">
      <section class="ops-panel"><header><h2>${t("授权覆盖", "License coverage")}</h2><strong class="ops-coverage">${coverage}</strong></header>${bars(t("有效授权用户 / 当前账号", "Licensed / current accounts"), s.licensed_users, s.users, "teal")}<div class="ops-editions">${data.editions.map((row) => `<div><span>${escape(edition(row.edition))}</span><b>${fmt(row.users)}</b></div>`).join("") || empty("暂无有效授权", "No effective licenses")}</div>
        <h3>${t("30 天内到期", "Expiring within 30 days")} <span>${fmt(s.expiring_users)}</span></h3><div class="ops-expiring">${data.expiring.map((row) => `<button type="button" data-ops-user="${row.user_id}"><span>${escape(row.username || "#" + row.user_id)}</span><time>${date(row.expires_at)}</time>${icon("chevron-right")}</button>`).join("") || empty("暂无即将到期的授权用户", "No users with licenses expiring soon")}</div>
      </section>
      <section class="ops-panel"><header><h2>${t("客户端分发", "Client delivery")}</h2><span class="ops-asof">${t("所选周期", "Selected period")}</span></header>${bars("Windows", totals.windows, totalDownloads)}${bars("Android", totals.android, totalDownloads, "gold")}<div class="ops-service"><span>${t("分析接口请求", "Analysis requests")}</span><b>${fmt(a.requests)}</b><span>${t("异常响应", "Exceptions")}</span><b class="${tone(a.exceptions)}">${fmt(a.exceptions)}</b><span>${t("平均响应时间", "Mean response time")}</span><b>${a.avg_latency_ms === null ? "--" : fmt(Math.round(a.avg_latency_ms)) + " ms"}</b></div></section>
      <section class="ops-panel"><header><h2>${t("访问页面", "Visited pages")}</h2><span class="ops-asof">PV / UV</span></header><div class="ops-page-ranking">${data.pages.map((row, index) => `<div><small>${String(index + 1).padStart(2, "0")}</small><span title="${escape(row.path)}">${escape(row.path)}</span><strong>${fmt(row.pv)} <small>/ ${fmt(row.uv)}</small></strong></div>`).join("") || empty("暂无页面访问记录", "No page views recorded")}</div></section>
    </div>
    <footer class="ops-footnote"><span>${t("今日数据未完结 · 快照指标按当前状态统计", "Today is partial · snapshot metrics reflect current state")}</span><details><summary>${t("指标口径", "Metric definitions")}</summary><p>${t("PV 为已记录的访问事件；UV 按匿名访客标识在所选周期内去重，不直接相加每日 UV，也不等同于真人数。注册数保留已归档账号的历史注册；当前账号与有效授权排除已归档和已知测试账号。下载请求包含重复下载，不等同于安装数。同一用户可持有多个版本。", "PV counts recorded page-view events. UV deduplicates anonymous visitor IDs across the selected period, not the sum of daily UV or a count of real people. Registrations retain archived account history; current accounts and effective licenses exclude archived and known test accounts. Downloads are requests, including retries, not installations. A user can hold multiple editions.")}</p></details></footer>`;
    renderSelection(); icons();
  }
  window.ScorpioAdminOverview = {
    init(options) {
      config = options; root = byId("adminOverviewView");
      root.innerHTML = `<div class="ops-toolbar"><div class="ops-period" role="group" aria-label="${t("统计周期", "Reporting period")}">${[7, 30, 90].map((value) => `<button type="button" data-ops-days="${value}">${value} ${t("天", "days")}</button>`).join("")}</div><span id="opsRange" class="ops-range"></span><label class="portal-check"><input type="checkbox" id="opsAutoRefresh" checked>${t("自动刷新", "Auto refresh")}</label><button class="portal-icon" type="button" id="opsRefresh" title="${t("刷新大屏", "Refresh dashboard")}" aria-label="${t("刷新大屏", "Refresh dashboard")}">${icon("refresh-cw")}</button></div><div class="ops-status"><span><b></b>${t("运营监测", "Operations monitor")}</span><time id="opsFreshness">${t("等待刷新", "Awaiting refresh")}</time></div><p id="opsNotice" class="portal-notice hidden" role="status"></p><div id="opsBody">${empty("正在读取运营数据…", "Loading operations data…")}</div>`;
      root.addEventListener("click", (event) => {
        const period = event.target.closest("[data-ops-days]"); if (period && !busy) { days = Number(period.dataset.opsDays); selectedDay = ""; refresh(); }
        const day = event.target.closest("[data-ops-day]"); if (day) { selectedDay = day.dataset.opsDay; renderSelection(); }
        const go = event.target.closest("[data-ops-go]"), user = event.target.closest("[data-ops-user]");
        if (go) { const view = go.dataset.opsGo; if (["customers", "codes", "releases", "credentials"].includes(view)) { config.navigate("legacy"); window.ScorpioAdminDelivery.openView(view === "credentials" ? "logs" : view, view === "credentials" ? "licenses" : ""); } else config.navigate(view, go.dataset.opsStatus || ""); }
        if (user) config.viewUser(user.dataset.opsUser);
      });
      root.addEventListener("focusin", (event) => { if (event.target.matches("[data-ops-day]")) { selectedDay = event.target.dataset.opsDay; renderSelection(); } });
      byId("opsRefresh").onclick = refresh; byId("opsAutoRefresh").onchange = planRefresh;
      document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else if (authorized && active) refresh(); });
      icons();
    },
    activate(value) { active = value; if (!value) clearTimeout(timer); else if (authorized) { if (!data || root.classList.contains("ops-stale")) refresh(); else { render(); planRefresh(); } } },
    sessionChanged(value) { authorized = value; if (!value) { ++revision; clearTimeout(timer); data = null; signing = null; busy = false; byId("opsBody").textContent = ""; byId("opsFreshness").textContent = ""; } },
  };
})();
