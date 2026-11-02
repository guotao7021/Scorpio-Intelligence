(function () {
  "use strict";
  const {t, icon, icons} = window.ScorpioAccountViews;
  const api = document.querySelector('meta[name="scorpio-api-base"]').content;
  const challenges = new Map();
  let current = "login", loading;
  function hidePasswords() {
    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
      document.getElementById(button.getAttribute("aria-controls")).type = "password";
      button.setAttribute("aria-pressed", "false"); button.title = button.ariaLabel = t("显示密码", "Show password"); button.innerHTML = icon("eye");
    }); icons();
  }
  for (const tab of ["login", "register", "reset"]) {
    const form = document.getElementById(`${tab}Form`);
    if (tab !== "login") {
      const label = document.createElement("label"); label.textContent = t("确认密码", "Confirm password");
      const input = document.createElement("input"); input.type = "password"; input.id = `${tab}PasswordConfirm`; input.required = true; input.autocomplete = "new-password";
      label.append(input); form.querySelector('button[type="submit"]').before(label);
      const password = document.getElementById(`${tab}Password`);
      const validate = () => input.setCustomValidity(input.value === password.value ? "" : t("两次输入的密码不一致。", "Passwords do not match."));
      input.addEventListener("input", validate); password.addEventListener("input", validate);
    }
    form.querySelectorAll('input[type="password"]').forEach((input) => {
      const wrap = document.createElement("span"); wrap.className = "password-control"; input.before(wrap); wrap.append(input);
      const button = document.createElement("button"); button.type = "button"; button.className = "portal-icon"; button.dataset.passwordToggle = ""; button.setAttribute("aria-controls", input.id); wrap.append(button);
      button.addEventListener("click", () => {
        const visible = input.type === "password"; input.type = visible ? "text" : "password";
        button.setAttribute("aria-pressed", String(visible)); button.title = button.ariaLabel = visible ? t("隐藏密码", "Hide password") : t("显示密码", "Show password"); button.innerHTML = icon(visible ? "eye-off" : "eye"); icons();
      });
    });
    const panel = document.createElement("div"); panel.className = "auth-challenge";
    panel.innerHTML = `<span class="portal-muted">${t("安全验证", "Security verification")}</span><div data-challenge-widget></div><p role="status" aria-live="polite"></p><button class="portal-text-button" type="button" hidden>${icon("refresh-cw")}${t("重试验证", "Retry verification")}</button>`;
    form.querySelector('button[type="submit"]').before(panel);
    challenges.set(tab, {panel, token: "", id: null});
    panel.querySelector("button").addEventListener("click", () => { const item = challenges.get(tab); if (item.id !== null) reset(tab); else activate(tab); });
  }
  async function load() {
    const response = await fetch(`${api}/auth/security`, {cache: "no-store", signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error("security_unavailable");
    const policy = await response.json();
    if (!window.turnstile) await new Promise((resolve, reject) => {
      document.getElementById("authTurnstileScript")?.remove();
      const script = document.createElement("script"); script.id = "authTurnstileScript"; script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      const timer = setTimeout(() => { script.remove(); reject(new Error("challenge_timeout")); }, 12000);
      script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = () => { clearTimeout(timer); reject(new Error("challenge_load_failed")); }; document.head.append(script);
    });
    return policy;
  }
  async function activate(tab) {
    current = tab; hidePasswords(); const item = challenges.get(tab);
    if (item.id !== null) return;
    const message = item.panel.querySelector("p"), retry = item.panel.querySelector("button");
    message.textContent = t("正在加载验证…", "Loading verification…"); retry.hidden = true;
    try {
      const policy = await (loading ||= load().catch((error) => { loading = null; throw error; }));
      if (item.id !== null) return;
      const fail = () => { item.token = ""; message.textContent = t("验证未完成，请重试。", "Verification incomplete. Please retry."); retry.hidden = false; };
      item.id = window.turnstile.render(item.panel.querySelector("[data-challenge-widget]"), {sitekey: policy.site_key, action: `auth_${tab}`, theme: "dark", size: "flexible", language: document.documentElement.lang.startsWith("en") ? "en" : "zh-cn", callback(token) { item.token = token; message.textContent = t("验证通过", "Verified"); retry.hidden = true; }, "expired-callback": fail, "error-callback": fail, "timeout-callback": fail});
      if (!item.token) message.textContent = "";
    } catch { message.textContent = t("安全验证暂不可用，请检查网络后重试。", "Verification is unavailable. Check your connection and retry."); retry.hidden = false; }
  }
  function reset(tab) { const item = challenges.get(tab); item.token = ""; if (item.id !== null) window.turnstile?.reset(item.id); }
  window.ScorpioAuthControls = {activate, hidePasswords, reset, proof(tab = current) {
    const token = challenges.get(tab)?.token;
    if (!token) throw new Error(t("请先完成安全验证。", "Complete the security verification first."));
    return {turnstile_token: token, auth_context: "browser"};
  }};
  hidePasswords(); activate("login");
})();
