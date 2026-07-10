(function () {
  const API_BASE = "https://api.scorpio-intelligence.tech/v1";

  const form = document.getElementById("feedbackForm");
  const message = document.getElementById("feedbackMessage");
  const pageUrl = form ? form.elements.page_url : null;

  if (!form) return;

  if (pageUrl) {
    pageUrl.value = window.location.href;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const turnstileToken = String(form.elements.turnstile_token?.value || "").trim();
    if (!turnstileToken) {
      setMessage("Turnstile verification is required.", "error");
      return;
    }
    setMessage("正在提交反馈...", "loading");
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
      const payload = buildPayload(new FormData(form));
      const response = await fetch(`${API_BASE}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(errorText(data.error || `HTTP ${response.status}`));
      }
      form.reset();
      if (pageUrl) pageUrl.value = window.location.href;
      window.turnstile?.reset();
      setMessage(`已收到，反馈编号：${data.public_id || "已生成"}。感谢你把问题说清楚。`, "success");
    } catch (error) {
      window.turnstile?.reset();
      setMessage(error.message || "提交失败，请稍后重试。", "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

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
      invalid_json: "提交内容格式异常，请刷新页面后重试。",
    };
    return map[code] || `提交失败：${code}`;
  }
})();
