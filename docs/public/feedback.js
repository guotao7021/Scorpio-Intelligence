(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";
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

  if (!form || !message) return;

  if (pageUrl) pageUrl.value = window.location.href;
  initializeProtection();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateProtectionInput()) return;

    setMessage("正在提交反馈…", "loading");
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch(`${API_BASE}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload(new FormData(form))),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data.error || `HTTP ${response.status}`));

      form.reset();
      if (pageUrl) pageUrl.value = window.location.href;
      resetTurnstile();
      setMessage(`已收到，反馈编号：${data.public_id || "已生成"}。感谢你把问题说清楚。`, "success");
    } catch (error) {
      resetTurnstile();
      setMessage(error.message || "提交失败，请稍后重试。", "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  sendCodeButton?.addEventListener("click", sendVerificationCode);

  async function initializeProtection() {
    setMessage("正在准备安全验证…", "loading");
    try {
      const response = await fetch(`${API_BASE}/feedback/security`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
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
      setMessage("已启用邮箱验证码安全验证。", "");
      return;
    }

    emailVerification.hidden = true;
    turnstilePanel.hidden = false;
    if (emailInput) emailInput.required = false;
    if (codeInput) codeInput.required = false;
    try {
      await renderTurnstile();
      setMessage("", "");
    } catch {
      setMessage("安全验证组件加载失败，请检查网络后刷新页面。", "error");
    }
  }

  async function sendVerificationCode() {
    const email = String(emailInput?.value || "").trim();
    if (!email) {
      setMessage("请先填写联系邮箱。", "error");
      emailInput?.focus();
      return;
    }
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
      setMessage("验证码已发送，请在 10 分钟内填写并提交。", "success");
      codeInput?.focus();
    } catch (error) {
      setMessage(error.message || "验证码发送失败，请稍后重试。", "error");
    } finally {
      if (sendCodeButton) sendCodeButton.disabled = false;
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
    turnstileWidget.innerHTML = "";
    turnstileWidgetId = window.turnstile.render(turnstileWidget, {
      sitekey: TURNSTILE_SITE_KEY,
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
      script.addEventListener("load", () => window.turnstile ? resolve() : reject(new Error("turnstile_unavailable")), { once: true });
      script.addEventListener("error", () => reject(new Error("turnstile_load_failed")), { once: true });
    });
  }

  function resetTurnstile() {
    form.elements.turnstile_token.value = "";
    if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId);
  }

  function buildPayload(data) {
    const type = data.get("type") || "bug";
    return {
      type,
      product_area: data.get("product_area") || "website",
      priority: data.get("priority") || "normal",
      title: data.get("title") || "",
      description: data.get("description") || "",
      contact_email: data.get("contact_email") || "",
      page_url: data.get("page_url") || window.location.href,
      client_version: data.get("client_version") || "",
      environment: data.get("environment") || "",
      rating: Number(data.get("rating") || 0),
      turnstile_token: data.get("turnstile_token") || "",
      feedback_verification_code: data.get("feedback_verification_code") || "",
      company_website: data.get("company_website") || "",
      survey_answers: {
        role: data.get("role") || "",
        biggest_blocker: data.get("biggest_blocker") || "",
        expected_improvement: data.get("expected_improvement") || "",
        allow_contact: data.get("allow_contact") === "on",
      },
    };
  }

  function setMessage(text, type) {
    message.textContent = text;
    message.className = `feedback-message ${type || ""}`.trim();
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
