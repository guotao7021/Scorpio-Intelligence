(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";
  const TOKEN_KEY = "scorpio_admin_token";
  localStorage.removeItem(TOKEN_KEY);

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || "",
    rows: [],
    selectedId: null,
    q: "",
    status: "",
    type: "",
  };

  const els = {
    tokenForm: byId("feedbackTokenForm"),
    tokenInput: byId("feedbackAdminToken"),
    clearToken: byId("clearFeedbackToken"),
    message: byId("feedbackAdminMessage"),
    search: byId("feedbackSearch"),
    statusFilter: byId("feedbackStatusFilter"),
    typeFilter: byId("feedbackTypeFilter"),
    refresh: byId("refreshFeedbackButton"),
    inbox: byId("feedbackInbox"),
    detail: byId("feedbackDetail"),
    listMeta: byId("feedbackListMeta"),
    total: byId("metricFeedbackTotal"),
    open: byId("metricFeedbackOpen"),
    high: byId("metricFeedbackHigh"),
    survey: byId("metricFeedbackSurvey"),
  };

  els.tokenInput.value = state.token;

  els.tokenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.token = els.tokenInput.value.trim();
    if (!state.token) {
      setMessage("请先输入 Admin Token。", "warn");
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, state.token);
    await loadFeedback();
  });

  els.clearToken.addEventListener("click", () => {
    state.token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    els.tokenInput.value = "";
    state.rows = [];
    state.selectedId = null;
    render();
    setMessage("已清除本地 Token。", "success");
  });

  els.search.addEventListener("input", debounce(() => {
    state.q = els.search.value.trim();
    loadFeedback();
  }, 280));
  els.statusFilter.addEventListener("change", () => {
    state.status = els.statusFilter.value;
    loadFeedback();
  });
  els.typeFilter.addEventListener("change", () => {
    state.type = els.typeFilter.value;
    loadFeedback();
  });
  els.refresh.addEventListener("click", loadFeedback);

  els.inbox.addEventListener("click", (event) => {
    const item = event.target.closest("[data-feedback-id]");
    if (!item) return;
    state.selectedId = Number(item.dataset.feedbackId);
    render();
  });

  els.detail.addEventListener("submit", async (event) => {
    const form = event.target.closest("#feedbackUpdateForm");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    await updateFeedback(Number(data.get("id")), {
      status: data.get("status"),
      priority: data.get("priority"),
      admin_notes: data.get("admin_notes"),
    });
  });

  render();
  if (state.token) {
    loadFeedback();
  }

  async function loadFeedback() {
    if (!state.token) {
      setMessage("请输入 Admin Token 后连接反馈池。", "warn");
      return;
    }
    setMessage("正在读取反馈记录...", "loading");
    const params = new URLSearchParams({ limit: "120" });
    if (state.q) params.set("q", state.q);
    if (state.status) params.set("status", state.status);
    if (state.type) params.set("type", state.type);
    try {
      const data = await request(`/scorpio_v1_admin/feedback?${params.toString()}`);
      state.rows = data.results || [];
      if (state.selectedId && !state.rows.some((row) => Number(row.id) === Number(state.selectedId))) {
        state.selectedId = null;
      }
      render();
      setMessage("反馈池已连接。", "success");
    } catch (error) {
      render();
      setMessage(error.message || "反馈记录读取失败。", "error");
    }
  }

  async function updateFeedback(id, payload) {
    setMessage("正在更新反馈状态...", "loading");
    try {
      await request(`/scorpio_v1_admin/feedback/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: payload,
      });
      await loadFeedback();
      state.selectedId = id;
      render();
      setMessage("反馈状态已更新。", "success");
    } catch (error) {
      setMessage(error.message || "更新失败。", "error");
    }
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-admin-token": state.token,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(errorText(data.error || `HTTP ${response.status}`));
    }
    return data;
  }

  function render() {
    renderMetrics();
    renderInbox();
    renderDetail();
  }

  function renderMetrics() {
    const rows = state.rows;
    els.total.textContent = rows.length ? String(rows.length) : "-";
    els.open.textContent = rows.length ? String(rows.filter((row) => ["new", "triaged", "in_progress"].includes(row.status)).length) : "-";
    els.high.textContent = rows.length ? String(rows.filter((row) => ["high", "urgent"].includes(row.priority)).length) : "-";
    els.survey.textContent = rows.length ? String(rows.filter((row) => row.type === "survey").length) : "-";
    els.listMeta.textContent = rows.length ? `${rows.length} 条记录` : state.token ? "暂无记录" : "等待连接";
  }

  function renderInbox() {
    if (!state.token) {
      els.inbox.innerHTML = '<div class="empty-state">输入 Admin Token 后读取反馈记录。</div>';
      return;
    }
    if (!state.rows.length) {
      els.inbox.innerHTML = '<div class="empty-state">当前筛选下没有反馈记录。</div>';
      return;
    }
    els.inbox.innerHTML = state.rows.map((row) => `
      <article class="feedback-row ${Number(row.id) === Number(state.selectedId) ? "active" : ""}" data-feedback-id="${escapeHtml(row.id)}">
        <div>
          <span>${escapeHtml(typeLabel(row.type))} / ${escapeHtml(areaLabel(row.product_area))}</span>
          <strong>${escapeHtml(row.title)}</strong>
          <small>${escapeHtml(row.public_id)} · ${escapeHtml(formatDate(row.created_at))}</small>
        </div>
        <div class="feedback-row-tags">
          <em class="status-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</em>
          <em>${escapeHtml(priorityLabel(row.priority))}</em>
        </div>
      </article>
    `).join("");
  }

  function renderDetail() {
    const row = state.rows.find((item) => Number(item.id) === Number(state.selectedId));
    if (!row) {
      els.detail.innerHTML = `
        <p class="section-kicker">Detail</p>
        <h2>选择一条反馈</h2>
        <p class="muted">点击左侧反馈后，可以查看完整内容并更新状态。</p>
      `;
      return;
    }
    const survey = parseJson(row.survey_answers, {});
    els.detail.innerHTML = `
      <p class="section-kicker">${escapeHtml(row.public_id)}</p>
      <h2>${escapeHtml(row.title)}</h2>
      <div class="feedback-detail-meta">
        <span>${escapeHtml(typeLabel(row.type))}</span>
        <span>${escapeHtml(areaLabel(row.product_area))}</span>
        <span>${escapeHtml(priorityLabel(row.priority))}</span>
        <span>${escapeHtml(statusLabel(row.status))}</span>
      </div>
      <dl class="feedback-detail-list">
        <dt>提交时间</dt><dd>${escapeHtml(formatDate(row.created_at))}</dd>
        <dt>联系邮箱</dt><dd>${escapeHtml(row.contact_email || "-")}</dd>
        <dt>版本/环境</dt><dd>${escapeHtml([row.client_version, row.environment].filter(Boolean).join(" / ") || "-")}</dd>
        <dt>页面</dt><dd>${row.page_url ? `<a href="${escapeHtml(row.page_url)}" target="_blank" rel="noreferrer">${escapeHtml(shortText(row.page_url, 80))}</a>` : "-"}</dd>
        <dt>满意度</dt><dd>${escapeHtml(row.rating ? `${row.rating}/5` : "-")}</dd>
      </dl>
      <section class="feedback-detail-body">
        <h3>用户描述</h3>
        <p>${escapeHtml(row.description).replaceAll("\n", "<br>")}</p>
      </section>
      <section class="feedback-detail-body">
        <h3>问卷信息</h3>
        <p>${escapeHtml(renderSurvey(survey))}</p>
      </section>
      <form class="feedback-update-form" id="feedbackUpdateForm">
        <input type="hidden" name="id" value="${escapeHtml(row.id)}">
        <label>状态
          <select name="status">
            ${["new", "triaged", "in_progress", "resolved", "closed"].map((status) => (
              `<option value="${status}" ${row.status === status ? "selected" : ""}>${statusLabel(status)}</option>`
            )).join("")}
          </select>
        </label>
        <label>优先级
          <select name="priority">
            ${["low", "normal", "high", "urgent"].map((priority) => (
              `<option value="${priority}" ${row.priority === priority ? "selected" : ""}>${priorityLabel(priority)}</option>`
            )).join("")}
          </select>
        </label>
        <label class="wide">处理备注
          <textarea name="admin_notes" rows="5" placeholder="记录处理结论、修复分支、答复口径或后续动作">${escapeHtml(row.admin_notes || "")}</textarea>
        </label>
        <button class="button primary" type="submit">保存处理结果</button>
      </form>
    `;
  }

  function renderSurvey(survey) {
    const parts = [
      survey.role ? `角色：${survey.role}` : "",
      survey.biggest_blocker ? `卡点：${survey.biggest_blocker}` : "",
      survey.expected_improvement ? `期望改进：${survey.expected_improvement}` : "",
      survey.allow_contact ? "允许联系：是" : "",
    ].filter(Boolean);
    return parts.length ? parts.join("；") : "-";
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), delay);
    };
  }

  function parseJson(text, fallback) {
    try {
      return JSON.parse(text || "");
    } catch {
      return fallback;
    }
  }

  function setMessage(text, type) {
    els.message.textContent = text;
    els.message.className = type || "";
  }

  function typeLabel(value) {
    return { bug: "Bug", experience: "体验", question: "提问", survey: "问卷" }[value] || value || "-";
  }

  function areaLabel(value) {
    return {
      website: "官网",
      account: "账号",
      license: "授权",
      desktop: "客户端",
      data_sync: "数据同步",
      research: "标的研究",
      admin: "后台",
      other: "其他",
    }[value] || value || "-";
  }

  function statusLabel(value) {
    return {
      new: "新反馈",
      triaged: "已分诊",
      in_progress: "处理中",
      resolved: "已解决",
      closed: "已关闭",
    }[value] || value || "-";
  }

  function priorityLabel(value) {
    return { low: "低", normal: "普通", high: "高", urgent: "紧急" }[value] || value || "-";
  }

  function errorText(code) {
    const map = {
      admin_token_required: "Admin Token 不正确或服务端未配置。",
      feedback_not_found: "反馈记录不存在。",
      feedback_id_invalid: "反馈 ID 无效。",
    };
    return map[code] || `请求失败：${code}`;
  }

  function formatDate(value) {
    if (!value) return "-";
    return String(value).replace("T", " ").slice(0, 16);
  }

  function shortText(value, max) {
    const text = String(value || "");
    return text.length > max ? `${text.slice(0, max)}...` : text;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function byId(id) {
    return document.getElementById(id);
  }
})();
