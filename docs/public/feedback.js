(function () {
  const API_BASE = document.querySelector('meta[name="scorpio-api-base"]')?.content || "https://api.scorpio-intelligence.tech/v1";
  const UI = window.ScorpioFeedbackCenter;
  const TURNSTILE_SITE_KEY = "0x4AAAAAADzKKGiOMI-xdBUr";

  const form = document.getElementById("feedbackForm");
  const message = document.getElementById("feedbackMessage");
  const pageUrl = form?.elements.page_url;
  const emailInput = form?.elements.contact_email;
  const codeInput = form?.elements.feedback_verification_code;
  const emailVerification = document.getElementById("feedbackEmailVerification");
  const sendCodeButton = document.getElementById("feedbackSendCode");
  const turnstilePanel = document.getElementById("feedbackTurnstile");
  const turnstileWidget = document.getElementById("feedbackTurnstileWidget");
  let protectionMode = "turnstile";
  let turnstileWidgetId = null;
  let submitting = false, protectionReady = false, codeTimer;

  if (!form || !message) return;

  if (pageUrl) pageUrl.value = window.location.origin + window.location.pathname;
  initializeProtection();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || UI && !UI.validate()) return;
    if (!protectionReady) { setMessage("安全验证组件加载失败，请检查网络后刷新页面。", "error"); return; }
    if (!validateProtectionInput()) return;
    const submitted = buildPayload(new FormData(form));

    setMessage("正在提交反馈…", "loading");
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    submitting = true; UI?.busy(true);

    try {
      const response = await fetch(`${API_BASE}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitted),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data.error || `HTTP ${response.status}`));
      if (!data.public_id) throw new Error("未收到反馈编号，提交结果尚未确认。");

      form.reset();
      if (pageUrl) pageUrl.value = window.location.origin + window.location.pathname;
      resetTurnstile();
      if (codeInput) codeInput.value = "";
      clearInterval(codeTimer);
      sendCodeButton.disabled = false; sendCodeButton.textContent = translate("发送验证码");
      UI?.receipt(data, submitted);
      setMessage(`已收到，反馈编号：${data.public_id || "已生成"}。感谢你把问题说清楚。`, "success");
    } catch (error) {
      resetTurnstile();
      if (codeInput) codeInput.value = "";
      setMessage(error.message || "提交失败，请稍后重试。", "error");
      if (error.name === "TimeoutError" || error.name === "TypeError") setMessage(document.documentElement.lang.startsWith("en") ? "Submission was not confirmed. Your content is retained. Request a new code before retrying." : "提交结果未确认，填写内容已保留。请重新获取验证码后重试。", "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
      submitting = false; UI?.busy(false);
    }
  });

  sendCodeButton?.addEventListener("click", sendVerificationCode);
  document.getElementById("feedbackRetryVerification")?.addEventListener("click", initializeProtection);

  async function initializeProtection() {
    protectionReady = false;
    const retry = document.getElementById("feedbackRetryVerification");
    if (retry) retry.hidden = true;
    setMessage("正在准备安全验证…", "loading");
    try {
      const response = await fetch(`${API_BASE}/feedback/security`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("verification_unavailable");
      protectionMode = data.mode === "email" ? "email" : "turnstile";
    } catch {
      // Fail closed to the normal Turnstile path. The server independently
      // selects and verifies the required protection mode.
      protectionMode = "turnstile";
    }

    if (protectionMode === "email") {
      emailVerification.hidden = false;
      turnstilePanel.hidden = true;
      if (emailInput) emailInput.required = true;
      if (codeInput) codeInput.required = true;
      protectionReady = true;
      setMessage("已启用邮箱验证码安全验证。", "");
      return;
    }

    emailVerification.hidden = true;
    turnstilePanel.hidden = false;
    if (emailInput) emailInput.required = false;
    if (codeInput) codeInput.required = false;
    try {
      await renderTurnstile();
      protectionReady = true;
      setMessage("", "");
    } catch {
      setMessage("安全验证组件加载失败，请检查网络后刷新页面。", "error");
      if (retry) retry.hidden = false;
    }
  }

  async function sendVerificationCode() {
    const email = String(emailInput?.value || "").trim();
    if (!email) {
      setMessage("请先填写联系邮箱。", "error");
      emailInput?.focus();
      return;
    }
    if (sendCodeButton?.disabled) return;
    if (emailInput && !emailInput.checkValidity()) { emailInput.reportValidity(); return; }
    if (sendCodeButton) sendCodeButton.disabled = true;
    setMessage("正在发送邮箱验证码…", "loading");
    try {
      const response = await fetch(`${API_BASE}/feedback/send-code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data.error || `HTTP ${response.status}`));
      let seconds = 60;
      const tick = () => { sendCodeButton.textContent = document.documentElement.lang.startsWith("en") ? `Resend in ${seconds}s` : `${seconds} 秒后重发`; };
      tick(); codeTimer = setInterval(() => { if (--seconds <= 0) { clearInterval(codeTimer); sendCodeButton.disabled = false; sendCodeButton.textContent = translate("发送验证码"); } else tick(); }, 1000);
      setMessage("验证码已发送，请在 10 分钟内填写并提交。", "success");
      codeInput?.focus();
    } catch (error) {
      if (sendCodeButton) sendCodeButton.disabled = false;
      setMessage(error.message || "验证码发送失败，请稍后重试。", "error");
    }
  }

  function validateProtectionInput() {
    if (protectionMode === "email") {
      if (!String(emailInput?.value || "").trim()) {
        setMessage("请填写联系邮箱以接收验证码。", "error");
        emailInput?.focus();
        return false;
      }
      if (!String(codeInput?.value || "").trim()) {
        setMessage("请填写邮箱验证码后再提交。", "error");
        codeInput?.focus();
        return false;
      }
      return true;
    }
    if (!String(form.elements.turnstile_token?.value || "").trim()) {
      setMessage("请先完成安全验证后再提交。", "error");
      return false;
    }
    return true;
  }

  async function renderTurnstile() {
    await loadTurnstileScript();
    if (!window.turnstile || !turnstileWidget) throw new Error("turnstile_unavailable");
    if (turnstileWidgetId !== null) { window.turnstile.reset(turnstileWidgetId); return; }
    turnstileWidget.innerHTML = "";
    turnstileWidgetId = window.turnstile.render(turnstileWidget, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      size: "flexible",
      language: document.documentElement.lang.startsWith("en") ? "en" : "zh-cn",
      callback(token) {
        form.elements.turnstile_token.value = token;
      },
      "expired-callback"() {
        form.elements.turnstile_token.value = "";
      },
      "error-callback"() {
        form.elements.turnstile_token.value = "";
      },
    });
  }

  function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve();
    const existing = document.querySelector('script[data-scorpio-turnstile="true"]');
    if (existing) return waitForTurnstile(existing);

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.scorpioTurnstile = "true";
    document.head.appendChild(script);
    return waitForTurnstile(script);
  }

  function waitForTurnstile(script) {
    return new Promise((resolve, reject) => {
      if (window.turnstile) return resolve();
      const timer = setTimeout(() => reject(new Error("turnstile_load_failed")), 15000);
      script.addEventListener("load", () => { clearTimeout(timer); window.turnstile ? resolve() : reject(new Error("turnstile_unavailable")); }, { once: true });
      script.addEventListener("error", () => { clearTimeout(timer); reject(new Error("turnstile_load_failed")); }, { once: true });
    });
  }

  function resetTurnstile() {
    form.elements.turnstile_token.value = "";
    if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId);
  }

  function buildPayload(data) {
    const type = data.get("type") || "bug";
    const parts = [data.get("description") || ""];
    if (type === "bug") for (const [name, cn, en] of [["steps", "重现步骤", "Steps to reproduce"], ["expected", "预期结果", "Expected result"], ["actual", "实际结果", "Actual result"]]) {
      const value = data.get(name); if (value) parts.push(`${document.documentElement.lang.startsWith("en") ? en : cn}:\n${value}`);
    }
    return {
      type,
      product_area: data.get("product_area") || "website",
      priority: data.get("priority") || "normal",
      title: data.get("title") || "",
      description: parts.join("\n\n"),
      contact_email: data.get("contact_email") || "",
      page_url: data.get("page_url") || window.location.href,
      client_version: data.get("client_version") || "",
      environment: [data.get("platform"), data.get("environment")].filter(Boolean).join(" / "),
      rating: type === "survey" ? Number(data.get("rating") || 0) : 0,
      turnstile_token: data.get("turnstile_token") || "",
      feedback_verification_code: data.get("feedback_verification_code") || "",
      company_website: data.get("company_website") || "",
      survey_answers: {
        role: type === "survey" ? data.get("role") || "" : "",
        biggest_blocker: type === "survey" ? data.get("biggest_blocker") || "" : "",
        expected_improvement: type === "survey" ? data.get("expected_improvement") || "" : "",
        allow_contact: data.get("allow_contact") === "on",
      },
    };
  }

  function setMessage(text, type) {
    message.textContent = translate(text);
    message.className = text ? `portal-notice ${type || ""}`.trim() : "portal-notice hidden";
    message.setAttribute("role", type === "error" ? "alert" : "status");
  }

  function translate(text) {
    if (!document.documentElement.lang.startsWith("en")) return text;
    const map = {"发送验证码": "Send code", "正在提交反馈…": "Submitting feedback...", "正在准备安全验证…": "Preparing verification...", "已启用邮箱验证码安全验证。": "Email verification is enabled.", "安全验证组件加载失败，请检查网络后刷新页面。": "Verification could not load. Check your network and reload the page.", "请先填写联系邮箱。": "Enter a contact email.", "正在发送邮箱验证码…": "Sending verification code...", "验证码已发送，请在 10 分钟内填写并提交。": "Code sent. It is valid for 10 minutes.", "请填写联系邮箱以接收验证码。": "Enter a contact email to receive a code.", "请填写邮箱验证码后再提交。": "Enter your email verification code.", "请先完成安全验证后再提交。": "Complete security verification before submitting.", "请填写反馈标题。": "Enter a subject.", "请填写详细说明。": "Enter a description.", "邮箱格式不正确。": "The email address is invalid.", "验证码无效，请重新获取后填写。": "The code is incorrect or used. Request a new one.", "验证码已过期，请重新获取。": "The code expired. Request a new one.", "当前网络获取验证码过于频繁，请稍后再试。": "Too many code requests from this network. Try again later.", "该邮箱获取验证码过于频繁，请稍后再试。": "Too many code requests. Try again later.", "提交过于频繁，请稍后再试。": "Too many submissions. Try again later.", "邮件服务暂不可用，请稍后重试。": "Email delivery is unavailable. Try again later.", "验证码发送失败，请稍后重试。": "The code could not be sent. Try again later.", "安全验证未通过，请刷新后重新验证。": "Security verification failed. Reload and verify again.", "安全验证服务暂不可用，请稍后重试。": "Security verification is unavailable. Try again later.", "反馈服务正在维护中，请稍后重试。": "Feedback is under maintenance. Try again later.", "提交失败，请稍后重试。": "Submission failed. Your content has been retained. Try again later.", "未收到反馈编号，提交结果尚未确认。": "No reference was returned. Submission is not confirmed."};
    if (map[text]) return map[text];
    if (/^已收到，反馈编号/.test(text)) return "Your feedback has been received.";
    if (/^提交失败：/.test(text)) return "Submission did not complete. Please try again later.";
    return text;
  }

  function errorText(code) {
    const map = {
      feedback_title_required: "请填写反馈标题。",
      feedback_description_required: "请填写详细说明。",
      email_invalid: "邮箱格式不正确。",
      feedback_email_required: "请填写联系邮箱以接收验证码。",
      feedback_verification_code_required: "请填写邮箱验证码后再提交。",
      verification_code_invalid: "验证码无效，请重新获取后填写。",
      verification_code_expired: "验证码已过期，请重新获取。",
      feedback_code_ip_rate_limited: "当前网络获取验证码过于频繁，请稍后再试。",
      feedback_code_email_rate_limited: "该邮箱获取验证码过于频繁，请稍后再试。",
      feedback_ip_rate_limited: "提交过于频繁，请稍后再试。",
      email_delivery_not_configured: "邮件服务暂不可用，请稍后重试。",
      email_delivery_failed: "验证码发送失败，请稍后重试。",
      turnstile_token_required: "请先完成安全验证后再提交。",
      turnstile_verification_failed: "安全验证未通过，请刷新后重新验证。",
      turnstile_verification_unavailable: "安全验证服务暂不可用，请稍后重试。",
      turnstile_verification_not_configured: "反馈服务正在维护中，请稍后重试。",
    };
    return map[code] || `提交失败：${code}`;
  }
})();
