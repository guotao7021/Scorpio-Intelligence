(function () {
  "use strict";
  const {t, escape, icon, icons, date} = window.ScorpioAccountViews;
  const en = document.documentElement.lang.startsWith("en"), byId = (id) => document.getElementById(id);
  const DRAFT = "scorpio_feedback_draft_v2";
  const types = {bug: ["故障报告", "Issue report", "bug"], experience: ["体验建议", "Suggestion", "lightbulb"], question: ["使用咨询", "Question", "circle-help"], survey: ["使用调研", "Survey", "list-checks"]};
  const areas = {website: ["官网与用户中心", "Website & account"], account: ["注册与登录", "Registration & sign-in"], license: ["授权与续期", "Licenses & renewals"], desktop: ["桌面或 Android 客户端", "Desktop / Android client"], data_sync: ["数据同步", "Data sync"], research: ["研究功能", "Research tools"], admin: ["授权管理后台", "License administration"], other: ["其他", "Other"]};
  const priorities = {normal: ["部分功能受影响", "Partially affected"], high: ["主要功能受影响", "Major functions affected"], urgent: ["无法继续使用", "Unable to continue"], low: ["不影响使用", "No disruption"]};
  const options = (values) => Object.entries(values).map(([value, labels]) => `<option value="${value}">${t(...labels)}</option>`).join("");
  const field = (label, name, control, wide = false) => `<div class="feedback-field ${wide ? "wide" : ""}"><label for="fb-${name}">${label}</label>${control}<span class="feedback-field-error" id="fb-error-${name}" data-error-for="${name}" hidden></span></div>`;
  const input = (name, attrs = "") => `<input id="fb-${name}" name="${name}" aria-describedby="fb-error-${name}" ${attrs}>`;
  const textarea = (name, max, required = false) => `<textarea id="fb-${name}" name="${name}" maxlength="${max}" rows="3" aria-describedby="fb-error-${name}" ${required ? "required" : ""}></textarea>`;
  const select = (name, choices) => `<select id="fb-${name}" name="${name}">${choices}</select>`;
  const site = en ? "index-en.html" : "index-cn.html";
  byId("feedbackDesk").innerHTML = `
    <header class="site-header portal-header"><a class="brand" href="${site}" aria-label="Scorpio Intelligence"><img src="assets/scorpio-logo-horizontal.svg" alt="Scorpio Intelligence"></a><nav aria-label="${t("主导航", "Main navigation")}"><a href="${site}">${t("官网首页", "Website")}</a><a href="account.html${en ? "?lang=en" : ""}">${t("用户中心", "My account")}</a><a class="active" href="feedback-${en ? "en" : "cn"}.html">${t("用户反馈", "Feedback")}</a></nav><div class="lang-switch" aria-label="${t("语言切换", "Language")}"><a href="feedback-cn.html" ${!en ? 'class="active" aria-current="page"' : ""}>中文</a><a href="feedback-en.html" ${en ? 'class="active" aria-current="page"' : ""}>EN</a></div></header>
    <main class="feedback-desk"><div class="feedback-page-head"><div><p class="portal-eyebrow">SCORPIO SUPPORT</p><h1>${t("用户反馈", "Feedback")}</h1></div><a class="portal-text-button" href="faq-${en ? "en" : "cn"}.html">${icon("book-open")}${t("常见问题", "FAQ")}</a></div>
    <div id="feedbackComposer"><nav class="feedback-steps" aria-label="${t("提交进度", "Submission progress")}">${[["问题信息", "Issue"], ["详情与环境", "Details"], ["核对与提交", "Review"]].map((labels, i) => `<button type="button" data-feedback-step-link="${i}"><span>${i + 1}</span>${t(...labels)}</button>`).join("")}</nav>
    <div class="feedback-workspace"><form id="feedbackForm" novalidate>
      <fieldset data-feedback-step="0"><legend>${t("问题信息", "Issue information")}</legend><div class="feedback-types" role="radiogroup" aria-label="${t("反馈类型", "Feedback type")}">${Object.entries(types).map(([value, labels], i) => `<label><input type="radio" name="type" value="${value}" ${i === 0 ? "checked" : ""}>${icon(labels[2])}<span>${t(labels[0], labels[1])}</span></label>`).join("")}</div>
      <div class="feedback-fields">${field(t("所属模块", "Product area"), "product_area", select("product_area", options(areas)))}${field(t("影响范围", "Impact"), "priority", select("priority", options(priorities)))}${field(t("反馈标题", "Subject"), "title", input("title", `type="text" maxlength="160" required placeholder="${t("例如：续期后到期日期未更新", "Example: expiry did not update after renewal")}"`), true)}</div></fieldset>
      <fieldset data-feedback-step="1" hidden><legend>${t("详情与环境", "Details & environment")}</legend><div class="feedback-fields">${field(t("详细说明", "Description"), "description", textarea("description", 1800, true), true)}
        <div class="wide feedback-fields" id="feedbackBugFields">${field(t("重现步骤", "Steps to reproduce"), "steps", textarea("steps", 1000), true)}${field(t("预期结果", "Expected result"), "expected", textarea("expected", 700))}${field(t("实际结果", "Actual result"), "actual", textarea("actual", 700))}</div>
        ${field(t("使用平台", "Platform"), "platform", select("platform", options({browser: ["浏览器", "Browser"], windows: ["Windows", "Windows"], android: ["Android", "Android"], other: ["其他", "Other"]})))}${field(t("客户端版本（选填）", "Client version (optional)"), "client_version", input("client_version", 'type="text" maxlength="80" placeholder="v0.1.24"'))}${field(t("环境补充（选填）", "Environment (optional)"), "environment", input("environment", 'type="text" maxlength="350" placeholder="Windows 11 / Chrome"'), true)}
        <div class="wide feedback-fields" id="feedbackSurveyFields" hidden>${field(t("满意度", "Satisfaction"), "rating", select("rating", options({0: ["暂不评分", "No score"], 5: ["5 - 很满意", "5 - Very satisfied"], 4: ["4 - 满意", "4 - Satisfied"], 3: ["3 - 一般", "3 - Neutral"], 2: ["2 - 不满意", "2 - Dissatisfied"], 1: ["1 - 很不满意", "1 - Very dissatisfied"]})))}${field(t("使用角色", "Your role"), "role", select("role", options({"": ["未选择", "Not selected"], personal_investor: ["个人投资者", "Individual investor"], researcher: ["研究人员", "Researcher"], operator: ["产品评估", "Product evaluation"], other: ["其他", "Other"]})))}${field(t("主要卡点（选填）", "Main obstacle (optional)"), "biggest_blocker", input("biggest_blocker", 'type="text" maxlength="500"'), true)}${field(t("期望改进（选填）", "Desired improvement (optional)"), "expected_improvement", input("expected_improvement", 'type="text" maxlength="500"'), true)}</div>
      </div><p class="feedback-privacy">${icon("shield-check")}${t("请勿提交密码、完整授权码、私人持仓或其他敏感信息。", "Do not include passwords, complete license codes, private holdings or other sensitive data.")}</p></fieldset>
      <fieldset data-feedback-step="2" hidden><legend>${t("核对与提交", "Review & submit")}</legend><div id="feedbackReview" class="feedback-review"></div><div class="feedback-fields">${field(t("联系邮箱", "Contact email"), "contact_email", input("contact_email", 'type="email" autocomplete="email" maxlength="254"'), true)}
        <div class="wide" id="feedbackEmailVerification" hidden>${field(t("邮箱验证码", "Email verification code"), "feedback_verification_code", `<div class="feedback-code-row">${input("feedback_verification_code", 'type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"')}<button class="button secondary" id="feedbackSendCode" type="button">${t("发送验证码", "Send code")}</button></div>`, true)}<p class="portal-muted">${t("验证码有效期为 10 分钟。", "The code is valid for 10 minutes.")}</p></div>
        <label class="portal-check wide"><input name="allow_contact" type="checkbox">${t("允许通过邮箱联系我补充问题细节", "Allow follow-up questions by email")}</label></div><div id="feedbackTurnstile" hidden><div id="feedbackTurnstileWidget"></div></div></fieldset>
      <input name="page_url" type="hidden"><input name="turnstile_token" type="hidden"><div class="feedback-honeypot" aria-hidden="true"><label>Company website<input name="company_website" type="text" tabindex="-1" autocomplete="off"></label></div>
      <p id="feedbackMessage" class="portal-notice hidden" role="status" aria-live="polite"></p><div class="feedback-form-actions"><button type="button" class="button secondary" id="feedbackPrevious">${icon("arrow-left")}${t("上一步", "Back")}</button><button type="button" class="portal-text-button" id="feedbackSaveDraft">${icon("save")}${t("暂存草稿", "Save draft")}</button><button type="button" class="button primary" id="feedbackNext">${t("下一步", "Continue")}${icon("arrow-right")}</button><button type="submit" class="button primary" id="feedbackSubmit" hidden>${icon("send")}${t("提交反馈", "Submit feedback")}</button></div></form>
      <aside class="feedback-context"><h2>${t("反馈摘要", "Summary")}</h2><dl id="feedbackSummary"></dl><div class="feedback-context-links"><a href="account.html${en ? "?lang=en" : ""}">${icon("user-round")}${t("用户中心", "My account")}${icon("arrow-up-right")}</a><a href="mailto:guotao7021@gmail.com">${icon("mail")}${t("联系支持", "Contact support")}${icon("arrow-up-right")}</a></div><div id="feedbackDraftActions" hidden><button type="button" class="portal-text-button" id="feedbackRestoreDraft">${icon("rotate-ccw")}${t("恢复草稿", "Restore draft")}</button><button type="button" class="portal-text-button" id="feedbackDiscardDraft">${icon("trash-2")}${t("清除草稿", "Discard draft")}</button></div></aside></div></div>
      <section id="feedbackReceipt" class="feedback-receipt" hidden aria-labelledby="feedbackReceiptTitle"></section></main><footer class="portal-footer"><span>Scorpio Intelligence</span><span>${t("反馈用于产品改进与问题处理。", "Feedback is used for product improvements and issue resolution.")}</span><a href="mailto:guotao7021@gmail.com">guotao7021@gmail.com</a></footer>`;

  const retryVerification = document.createElement("button");
  retryVerification.type = "button"; retryVerification.id = "feedbackRetryVerification"; retryVerification.className = "portal-text-button"; retryVerification.hidden = true;
  retryVerification.innerHTML = `${icon("refresh-cw")}${t("重新加载安全验证", "Reload verification")}`;
  byId("feedbackTurnstile").after(retryVerification);
  const form = byId("feedbackForm");
  let step = 0, reached = 0, receipt;
  const value = (name) => String(form.elements[name]?.value || "").trim();
  const label = (values, key) => values[key] ? t(...values[key].slice(0, 2)) : key;
  const notify = (text, type = "success") => { byId("feedbackMessage").textContent = text; byId("feedbackMessage").className = `portal-notice ${type}`; byId("feedbackMessage").setAttribute("role", type === "error" ? "alert" : "status"); };
  function summary() {
    byId("feedbackSummary").innerHTML = [[t("反馈类型", "Type"), label(types, value("type"))], [t("所属模块", "Area"), label(areas, value("product_area"))], [t("影响范围", "Impact"), label(priorities, value("priority"))], [t("标题", "Subject"), value("title") || "--"]].map(([key, val]) => `<div><dt>${key}</dt><dd>${escape(val)}</dd></div>`).join("");
    byId("feedbackSummary").innerHTML += `<div><dt>${t("问题截图", "Screenshots")}</dt><dd>${window.ScorpioFeedbackUploads?.files().length || 0} / 3</dd></div>`;
  }
  function typeChanged() {
    const bug = value("type") === "bug", survey = value("type") === "survey";
    byId("feedbackBugFields").hidden = !bug; byId("feedbackSurveyFields").hidden = !survey;
    for (const name of ["steps", "expected", "actual"]) form.elements[name].required = bug;
    summary();
  }
  function showStep(next) {
    step = next; reached = Math.max(reached, step);
    document.querySelectorAll("[data-feedback-step]").forEach((node) => { node.hidden = Number(node.dataset.feedbackStep) !== step; });
    document.querySelectorAll("[data-feedback-step-link]").forEach((button) => { const index = Number(button.dataset.feedbackStepLink); button.classList.toggle("active", index === step); button.classList.toggle("complete", index < step); button.disabled = index > reached; if (index === step) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current"); });
    byId("feedbackPrevious").hidden = step === 0; byId("feedbackNext").hidden = step === 2; byId("feedbackSubmit").hidden = step !== 2;
    byId("feedbackMessage").classList.add("hidden");
    if (step === 2) byId("feedbackReview").innerHTML = `<div><strong>${escape(value("title"))}</strong><button class="portal-text-button" type="button" data-edit-feedback>${icon("pencil")}${t("编辑", "Edit")}</button></div><p>${escape(value("description"))}</p>${value("type") === "bug" ? ["steps", "expected", "actual"].map((name) => `<p>${escape(value(name))}</p>`).join("") : ""}`;
    icons(); form.querySelector(`[data-feedback-step="${step}"] legend`).scrollIntoView({block: "nearest"});
  }
  function validate(index) {
    let first;
    for (const field of form.querySelector(`[data-feedback-step="${index}"]`).querySelectorAll("input,select,textarea")) {
      if (field.closest("#feedbackBugFields[hidden],#feedbackSurveyFields[hidden],#feedbackEmailVerification[hidden]")) continue;
      const invalid = !field.checkValidity() || field.required && !field.value.trim(); field.setAttribute("aria-invalid", String(invalid));
      const error = document.querySelector(`[data-error-for="${field.name}"]`);
      if (error) { error.hidden = !invalid; error.textContent = invalid ? field.validity.typeMismatch ? t("请输入有效的邮箱地址。", "Enter a valid email address.") : t("请完整填写此项。", "Complete this field.") : ""; }
      if (invalid && !first) first = field;
    }
    if (first) { showStep(index); notify(t("请检查标记的必填信息。", "Check the highlighted required fields."), "error"); first.focus(); return false; }
    return true;
  }
  byId("feedbackNext").addEventListener("click", () => { if (validate(step)) showStep(step + 1); });
  byId("feedbackPrevious").addEventListener("click", () => showStep(step - 1));
  document.querySelectorAll("[data-feedback-step-link]").forEach((button) => button.addEventListener("click", () => { const next = Number(button.dataset.feedbackStepLink); if (next <= step || validate(step)) showStep(next); }));
  byId("feedbackReview").addEventListener("click", (event) => { if (event.target.closest("[data-edit-feedback]")) showStep(0); });
  form.addEventListener("input", (event) => { summary(); const field = event.target; if (field.name && field.checkValidity()) { field.removeAttribute("aria-invalid"); const error = document.querySelector(`[data-error-for="${field.name}"]`); if (error) error.hidden = true; } });
  form.addEventListener("change", typeChanged);
  const draftFields = ["type", "product_area", "priority", "title", "description", "steps", "expected", "actual", "platform", "client_version", "environment", "rating", "role", "biggest_blocker", "expected_improvement", "contact_email"];
  byId("feedbackSaveDraft").addEventListener("click", () => {
    try { sessionStorage.setItem(DRAFT, JSON.stringify(Object.fromEntries(draftFields.map((key) => [key, value(key)])))); byId("feedbackDraftActions").hidden = false; notify(window.ScorpioFeedbackUploads?.files().length ? t("文字草稿已保存，截图仅保留在当前页面。", "Text draft saved. Screenshots are retained only on the current page.") : t("草稿已暂存于当前标签页。", "Draft saved in this tab.")); }
    catch { notify(t("当前浏览器无法暂存草稿。", "This browser could not save the draft."), "error"); }
  });
  byId("feedbackRestoreDraft").addEventListener("click", () => { try { const draft = JSON.parse(sessionStorage.getItem(DRAFT) || "{}"); for (const key of draftFields) if (key in draft) form.elements[key].value = draft[key]; typeChanged(); showStep(0); notify(t("草稿已恢复。", "Draft restored.")); } catch { notify(t("草稿无法读取。", "The draft could not be read."), "error"); } });
  byId("feedbackDiscardDraft").addEventListener("click", () => { try { sessionStorage.removeItem(DRAFT); byId("feedbackDraftActions").hidden = true; notify(t("暂存草稿已清除，当前表单保持不变。", "Saved draft removed. The current form is unchanged.")); } catch {} });
  byId("feedbackReceipt").addEventListener("click", async (event) => {
    if (event.target.closest("#feedbackCopyReceipt")) { try { await navigator.clipboard.writeText(receipt.public_id); byId("feedbackReceiptMessage").textContent = t("反馈编号已复制。", "Reference copied."); } catch { byId("feedbackReceiptMessage").textContent = receipt.public_id; } byId("feedbackReceiptMessage").hidden = false; }
    if (event.target.closest("#feedbackDownloadReceipt")) { const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], {type: "application/json"})); const link = document.createElement("a"); link.href = url; link.download = `${receipt.public_id}.json`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
    if (event.target.closest("#feedbackNew")) { form.reset(); reached = 0; byId("feedbackReceipt").hidden = true; byId("feedbackComposer").hidden = false; typeChanged(); showStep(0); }
  });
  try { byId("feedbackDraftActions").hidden = !sessionStorage.getItem(DRAFT); const auth = JSON.parse(localStorage.getItem("scorpio_user_auth") || "{}"); if (auth.email) form.elements.contact_email.value = auth.email; } catch {}
  window.ScorpioFeedbackCenter = {
    summary,
    validate() { for (let i = 0; i < 3; i++) if (!validate(i)) return false; if (form.elements.allow_contact.checked && !value("contact_email")) { showStep(2); notify(t("允许联系时需填写联系邮箱。", "An email address is needed for follow-up."), "error"); form.elements.contact_email.focus(); return false; } return true; },
    busy(value) { form.setAttribute("aria-busy", String(value)); form.querySelectorAll("fieldset").forEach((node) => { node.disabled = value; }); document.querySelectorAll("[data-feedback-step-link],#feedbackPrevious,#feedbackNext,#feedbackSaveDraft").forEach((node) => { node.disabled = value || node.dataset.feedbackStepLink && Number(node.dataset.feedbackStepLink) > reached; }); },
    receipt(data, submitted) {
      receipt = {public_id: data.public_id, status: data.status, title: submitted.title, type: label(types, submitted.type), product_area: label(areas, submitted.product_area), submitted_at: new Date().toISOString()};
      try { sessionStorage.removeItem(DRAFT); } catch {} byId("feedbackDraftActions").hidden = true;
      byId("feedbackComposer").hidden = true; const node = byId("feedbackReceipt"); node.hidden = false;
      node.innerHTML = `<span class="feedback-receipt-mark">${icon("check")}</span><h2 id="feedbackReceiptTitle" tabindex="-1">${t("反馈已提交", "Feedback submitted")}</h2><p class="portal-muted">${data.duplicate ? t("已找到相同反馈，沿用原反馈编号。", "A matching submission was found. Your existing reference is retained.") : t("反馈已进入待处理队列。", "Your feedback is in the review queue.")}</p><div class="feedback-reference"><div><span>${t("反馈编号", "Reference")}</span><code>${escape(data.public_id)}</code></div><button type="button" class="portal-icon" id="feedbackCopyReceipt" aria-label="${t("复制编号", "Copy reference")}" title="${t("复制编号", "Copy reference")}">${icon("copy")}</button></div><dl><div><dt>${t("标题", "Subject")}</dt><dd>${escape(submitted.title)}</dd></div><div><dt>${t("处理状态", "Status")}</dt><dd>${t("待受理", "Awaiting review")}</dd></div><div><dt>${t("提交时间", "Submitted")}</dt><dd>${escape(date(receipt.submitted_at, true))}</dd></div></dl><p class="portal-notice" id="feedbackReceiptMessage" role="status" hidden></p><div class="portal-license-actions"><button class="button secondary" type="button" id="feedbackDownloadReceipt">${icon("download")}${t("下载回执", "Download receipt")}</button><button class="button primary" type="button" id="feedbackNew">${icon("plus")}${t("再提交一条", "New feedback")}</button></div><a class="portal-text-button" href="mailto:guotao7021@gmail.com?subject=${encodeURIComponent(data.public_id)}">${t("联系支持", "Contact support")}${icon("arrow-up-right")}</a>`;
      icons(); byId("feedbackReceiptTitle").focus();
    },
  };
  typeChanged(); showStep(0); icons();
})();
