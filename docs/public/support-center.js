(function () {
  "use strict";
  const {t, escape, icon, icons, date, empty, errorText} = window.ScorpioAccountViews;
  const labels = {new: ["待受理", "Submitted"], triaged: ["已受理", "Reviewed"], in_progress: ["处理中", "In progress"], resolved: ["已解决", "Resolved"], closed: ["已关闭", "Closed"]};
  const types = {bug: ["故障报告", "Issue report"], experience: ["体验建议", "Suggestion"], question: ["使用咨询", "Question"], survey: ["使用调研", "Survey"]};
  const priorities = {low: ["低", "Low"], normal: ["普通", "Normal"], high: ["高", "High"], urgent: ["紧急", "Urgent"]};
  const text = (map, key) => map[key] ? t(...map[key]) : key;
  const choices = (map, value = "") => Object.entries(map).map(([key, names]) => `<option value="${key}" ${key === value ? "selected" : ""}>${t(...names)}</option>`).join("");
  let config, root, section, active = false, page = {offset: 0, limit: 25}, rows = [], selected, revision = 0, detailRevision = 0, urls = [], dirty = false, saving = false, lightbox;
  const byId = (id) => document.getElementById(id);
  const notice = (message, type = "error") => { const node = byId("supportNotice"); node.textContent = message; node.className = `portal-notice ${type}`; };
  function releaseImages() { lightbox?.close(); urls.forEach((url) => URL.revokeObjectURL(url)); urls = []; }
  async function request(path, options = {}) {
    try { return await config.request(root + path, {...options, auth: !config.admin}); }
    catch (error) { if (config.admin && error.status === 403) config.invalidSession?.(); throw error; }
  }
  function safeLeave() { return !dirty || window.confirm(t("有尚未保存的处理内容，确定放弃吗？", "Discard unsaved changes?")); }
  async function load() {
    if (!active || saving) return;
    if (!safeLeave()) return;
    const sequence = ++revision, detailAtStart = detailRevision; const identity = selected?.id;
    byId("supportRefresh").disabled = true; byId("supportNotice").classList.add("hidden");
    try {
      const query = new URLSearchParams({q: byId("supportSearch").value.trim(), status: byId("supportStatus").value, type: byId("supportType").value, limit: String(page.limit), offset: String(page.offset)});
      const data = window.ScorpioAccountViews.requireContract(await request(`?${query}`), (value) => Array.isArray(value?.results) && window.ScorpioAccountViews.validPage(value.page) && value.metrics && ["total", "open", "high"].every((key) => Number.isFinite(value.metrics[key]))); if (!active || sequence !== revision) return;
      page = data.page; rows = data.results;
      byId("supportMetrics").innerHTML = [[t("全部反馈", "All feedback"), data.metrics.total || 0], [t("待处理问题", "Open issues"), data.metrics.open || 0], [t("高优先级待处理", "High-priority open"), data.metrics.high || 0]].map(([key, value]) => `<div><span>${key}</span><strong>${value}</strong></div>`).join("");
      byId("supportMetrics").classList.remove("hidden");
      renderList();
      byId("supportPageInfo").textContent = page.total ? `${page.offset + 1}-${Math.min(page.offset + page.limit, page.total)} / ${page.total}` : t("0 条反馈", "0 feedback items");
      byId("supportPrevious").disabled = page.offset === 0; byId("supportNext").disabled = !page.has_more;
      // A list response must not replace a detail opened or edited while it was in flight.
      if (detailRevision !== detailAtStart || dirty) return;
      if (identity && rows.some((row) => row.id === identity)) await open(identity, true);
      else { selected = null; dirty = false; ++detailRevision; releaseImages(); renderDetail(); }
    } catch (error) { if (active && sequence === revision) { notice(errorText(error)); if (!rows.length) byId("supportInbox").innerHTML = empty("反馈列表未加载", "Feedback could not be loaded"); } }
    finally { if (sequence === revision) byId("supportRefresh").disabled = false; }
  }
  function renderList() {
    byId("supportInbox").innerHTML = rows.length ? rows.map((row) => `<button type="button" class="support-row" data-support-id="${row.id}" aria-current="${selected?.id === row.id}"><div class="support-tags"><span data-state="${escape(row.status)}">${text(labels, row.status)}</span><small>${text(types, row.type)}${row.attachment_count ? ` · ${icon("paperclip")} ${row.attachment_count}` : ""}</small></div><strong>${escape(row.title)}</strong><small>${escape(row.public_id)}<br>${config.admin ? `${escape(row.contact_email || t("访客", "Guest"))} · ` : ""}${date(row.updated_at)}</small></button>`).join("") : empty("当前筛选下没有反馈", "No feedback matches your filters"); icons();
  }
  async function open(id, force = false) {
    if (!active || saving || !force && !safeLeave()) return;
    const sequence = ++detailRevision; dirty = false; selected = {id}; releaseImages(); renderList();
    byId("supportDetail").innerHTML = empty("正在读取问题详情…", "Loading issue details…");
    try {
      const detail = window.ScorpioAccountViews.requireContract(await request(`/detail?id=${id}`), (value) => value?.public_id && Array.isArray(value.attachments) && Array.isArray(value.events)); if (!active || sequence !== detailRevision) return;
      selected = detail; renderDetail();
      for (const attachment of detail.attachments) {
        if (!active || sequence !== detailRevision) return;
        const node = byId(`support-file-${attachment.attachment_id}`);
        try {
          const blob = await request(`/attachment?id=${encodeURIComponent(attachment.attachment_id)}`, {blob: true});
          if (!active || sequence !== detailRevision) return;
          const url = URL.createObjectURL(blob); urls.push(url);
          node.innerHTML = `<button type="button" data-support-image="${url}" data-file-name="${escape(attachment.file_name)}" title="${t("查看原图", "View image")}"><img src="${url}" alt="${escape(attachment.file_name)}"></button><small>${escape(attachment.file_name)} · ${Math.ceil(attachment.size_bytes / 1024)} KB</small>`;
        } catch { if (active && sequence === detailRevision) node.textContent = t("截图加载失败，请刷新详情重试。", "Image could not load. Refresh the details to retry."); }
      }
    } catch (error) { if (active && sequence === detailRevision) { selected = null; renderDetail(); notice(errorText(error)); } }
  }
  function renderDetail() {
    if (!selected?.public_id) { byId("supportDetail").innerHTML = empty("选择一条反馈查看详情", "Select a feedback item to view details"); return; }
    const row = selected; let survey = {}; try { survey = JSON.parse(row.survey_answers || "{}"); } catch {}
    const details = [[t("重现步骤", "Steps to reproduce"), survey.steps], [t("预期结果", "Expected result"), survey.expected], [t("实际结果", "Actual result"), survey.actual], [t("期望改进", "Desired improvement"), survey.expected_improvement], [t("主要卡点", "Main obstacle"), survey.biggest_blocker]];
    byId("supportDetail").innerHTML = `<div class="feedback-list-heading"><small class="portal-muted">${escape(row.public_id)}</small><button class="portal-icon" type="button" id="supportDetailRefresh" title="${t("刷新详情", "Refresh details")}" aria-label="${t("刷新详情", "Refresh details")}">${icon("refresh-cw")}</button></div><h2 tabindex="-1">${escape(row.title)}</h2><div class="support-tags"><span data-state="${escape(row.status)}">${text(labels, row.status)}</span><span>${text(types, row.type)}</span><span>${text(priorities, row.priority)}</span></div>
      <dl><dt>${t("提交时间", "Submitted")}</dt><dd>${date(row.created_at)}</dd><dt>${t("更新时间", "Updated")}</dt><dd>${date(row.updated_at)}</dd>${config.admin ? `<dt>${t("联系邮箱", "Contact")}</dt><dd>${escape(row.contact_email || "--")}</dd><dt>${t("账号归属", "Ownership")}</dt><dd>${row.user_id ? t("已关联注册用户", "Linked to a registered account") : t("访客提交（未关联）", "Guest submission (unlinked)")}</dd>` : ""}<dt>${t("版本与环境", "Environment")}</dt><dd>${escape([row.client_version, row.environment].filter(Boolean).join(" / ") || "--")}</dd></dl>
      <h3>${t("问题描述", "Description")}</h3><p>${escape(row.description)}</p>${details.filter(([, value]) => value).map(([name, value]) => `<h3>${name}</h3><p>${escape(value)}</p>`).join("")}
      <h3>${t("问题截图", "Screenshots")} (${row.attachments.length})</h3><div class="feedback-image-grid">${row.attachments.map((file) => `<div class="feedback-image" id="support-file-${file.attachment_id}"><p>${t("正在读取截图…", "Loading screenshot…")}</p></div>`).join("") || `<p>${t("未附截图", "No screenshots attached")}</p>`}</div>
      <h3>${t("处理进展", "Progress")}</h3><ol class="portal-timeline">${row.events.map((event) => `<li><strong>${text(labels, event.status)}</strong><small>${date(event.created_at)}</small>${event.reply ? `<p>${escape(event.reply)}</p>` : ""}</li>`).join("") || `<li>${text(labels, row.status)}</li>`}</ol>
      ${row.public_reply ? `<section class="support-reply"><h3>${t("支持回复", "Support reply")}</h3><p>${escape(row.public_reply)}</p></section>` : `<p>${t("暂时没有支持回复。", "No support reply yet.")}</p>`}
      ${config.admin ? `<form id="supportUpdate"><label>${t("处理状态", "Status")}<select name="status">${choices(labels, row.status)}</select></label><label>${t("优先级", "Priority")}<select name="priority">${choices(priorities, row.priority)}</select></label><label>${t("回复用户", "Reply to user")}<textarea name="public_reply" maxlength="2000" rows="4">${escape(row.public_reply)}</textarea></label><label>${t("内部备注（仅管理员可见）", "Internal notes (administrators only)")}<textarea name="admin_notes" maxlength="2000" rows="3">${escape(row.admin_notes || "")}</textarea></label><button class="button primary" type="submit">${icon("check")}${t("保存处理结果", "Save changes")}</button><p id="supportUpdateMessage" role="status" aria-live="polite"></p></form>` : ""}`;
    byId("supportUpdate")?.addEventListener("input", () => { dirty = true; }); icons();
  }
  window.ScorpioSupportCenter = {
    init(options) {
      config = options; root = config.admin ? "/scorpio_v1_admin/feedback" : "/account/feedback";
      const en = document.documentElement.lang.startsWith("en");
      const nav = document.createElement("button"); nav.type = "button";
      if (config.admin) { nav.dataset.accountAdminView = "feedback"; nav.innerHTML = `${icon("messages-square")}<span>${t("问题反馈", "Feedback inbox")}</span>`; document.querySelector(".portal-admin-tabs").append(nav); }
      else { nav.dataset.accountView = "feedback"; nav.innerHTML = `${icon("messages-square")}<span>${t("我的反馈", "My feedback")}</span>`; document.querySelector(".portal-nav").append(nav); }
      section = document.createElement("section"); section.id = "supportCenterView"; section.className = "hidden"; section.ariaLabel = config.admin ? t("问题反馈", "Feedback inbox") : t("我的反馈", "My feedback");
      if (!config.admin) section.dataset.accountSection = "feedback";
      section.innerHTML = `<div class="portal-summary" id="supportMetrics"></div><div class="portal-toolbar"><label class="portal-search"><span class="visually-hidden">${t("搜索反馈", "Search feedback")}</span>${icon("search")}<input id="supportSearch" type="search" placeholder="${t("搜索标题或问题编号", "Search subject or reference")}"></label><label class="visually-hidden" for="supportStatus">${t("状态", "Status")}</label><select id="supportStatus"><option value="">${t("全部状态", "All statuses")}</option>${choices(labels)}</select><label class="visually-hidden" for="supportType">${t("类型", "Type")}</label><select id="supportType"><option value="">${t("全部类型", "All types")}</option>${choices(types)}</select>${!config.admin ? `<a class="button primary" href="feedback-${en ? "en" : "cn"}.html">${icon("plus")}${t("提交反馈", "New feedback")}</a>` : ""}<button class="portal-icon" id="supportRefresh" type="button" aria-label="${t("刷新反馈", "Refresh feedback")}" title="${t("刷新反馈", "Refresh feedback")}">${icon("refresh-cw")}</button></div><p id="supportNotice" class="portal-notice hidden" role="status" aria-live="polite"></p><div class="support-workbench"><div><div class="support-inbox" id="supportInbox"></div><div class="portal-pagination"><span id="supportPageInfo"></span><div><button class="portal-icon" id="supportPrevious" type="button" title="${t("上一页", "Previous page")}" aria-label="${t("上一页", "Previous page")}">${icon("chevron-left")}</button><button class="portal-icon" id="supportNext" type="button" title="${t("下一页", "Next page")}" aria-label="${t("下一页", "Next page")}">${icon("chevron-right")}</button></div></div></div><div class="support-detail" id="supportDetail"></div></div>`;
      document.querySelector(config.admin ? "#adminAccountNotice" : '[data-account-section="overview"]').after(section);
      byId("supportMetrics").classList.add("hidden");
      lightbox = document.createElement("dialog"); lightbox.className = "support-lightbox"; lightbox.ariaLabel = t("问题截图", "Screenshot"); lightbox.innerHTML = `<header><h2></h2><button class="portal-icon" type="button" aria-label="${t("关闭截图", "Close screenshot")}" title="${t("关闭截图", "Close screenshot")}">${icon("x")}</button></header><img alt="">`; document.body.append(lightbox); lightbox.querySelector("button").onclick = () => lightbox.close();
      byId("supportRefresh").onclick = load;
      let timer; byId("supportSearch").oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page.offset = 0; load(); }, 300); };
      for (const id of ["supportStatus", "supportType"]) byId(id).onchange = () => { page.offset = 0; load(); };
      byId("supportPrevious").onclick = () => { page.offset = Math.max(0, page.offset - page.limit); load(); };
      byId("supportNext").onclick = () => { if (page.has_more) { page.offset += page.limit; load(); } };
      byId("supportInbox").onclick = (event) => { const button = event.target.closest("[data-support-id]"); if (button) open(Number(button.dataset.supportId)); };
      byId("supportDetail").onclick = (event) => {
        if (event.target.closest("#supportDetailRefresh")) open(selected.id);
        const image = event.target.closest("[data-support-image]"); if (image) { lightbox.querySelector("img").src = image.dataset.supportImage; lightbox.querySelector("img").alt = image.dataset.fileName; lightbox.querySelector("h2").textContent = image.dataset.fileName; lightbox.showModal(); }
      };
      byId("supportDetail").onsubmit = async (event) => {
        event.preventDefault(); if (!config.admin || saving || !active) return;
        const form = event.target.closest("#supportUpdate"); if (!form) return;
        const item = selected, sequence = detailRevision; saving = true; form.querySelector('button[type="submit"]').disabled = true;
        try { await request(`/${item.id}`, {method: "PUT", body: {...Object.fromEntries(new FormData(form)), updated_at: item.updated_at}}); if (!active || sequence !== detailRevision) return; dirty = false; saving = false; await load(); notice(item.user_id ? t("处理结果已保存。用户可在“我的反馈”查看状态与回复。", "Saved. The user can see the status and reply in My feedback.") : t("处理结果已保存。此访客记录尚未关联账号。", "Saved. This guest submission is not linked to an account."), "success"); }
        catch (error) { if (active && sequence === detailRevision) byId("supportUpdateMessage").textContent = error.status === 409 ? t("此问题已被更新，请刷新详情后重新处理。", "This issue changed. Refresh the details before saving again.") : errorText(error); }
        finally { saving = false; if (form.isConnected) form.querySelector('button[type="submit"]').disabled = false; }
      };
      window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
      renderDetail(); icons();
    },
    sessionChanged(value) {
      active = value; ++revision; ++detailRevision; dirty = false; saving = false; selected = null; releaseImages(); rows = []; page = {offset: 0, limit: 25};
      if (!config) return; byId("supportInbox").textContent = ""; byId("supportMetrics").textContent = ""; byId("supportMetrics").classList.add("hidden"); byId("supportNotice").classList.add("hidden"); renderDetail();
      if (value) load();
    },
    navigate(view) { if (config?.admin) section.classList.toggle("hidden", view !== "feedback"); if (view === "feedback" && active && !rows.length) load(); },
    refresh: load,
  };
})();
