(function () {
  const isEnglish = new URLSearchParams(window.location.search).get("lang") === "en";
  if (!isEnglish) return;

  const text = {
    "用户中心 | Scorpio Intelligence": "Account | Scorpio Intelligence",
    "Scorpio Intelligence 用户中心：账号登录、授权激活、客户端下载与桌面端数据同步入口。": "Scorpio Intelligence account: sign in, activate a license, download the desktop client, and sync research data.",
    "Scorpio Intelligence 首页": "Scorpio Intelligence home",
    "主导航": "Main navigation",
    "平台": "Platform",
    "品牌叙事": "Story",
    "产品体验": "Experience",
    "版本": "Editions",
    "用户中心": "Account",
    "反馈": "Feedback",
    "语言切换": "Language switch",
    "管理网站账号、设备授权、客户端下载和桌面端数据同步。": "Manage your website account, device license, desktop downloads, and research-data sync.",
    "下一步": "NEXT STEP",
    "登录后激活授权": "Sign in to activate your license",
    "登录后可激活授权、检查发行包，并让桌面端使用同一账号同步云端数据。": "Sign in to activate your license, check available releases, and use the same account to sync cloud data in the desktop app.",
    "下载 Scorpio Intelligence": "Download Scorpio Intelligence",
    "获取与你当前授权版本匹配的稳定版客户端。": "Get the stable desktop client that matches your current license.",
    "正在读取...": "Loading…",
    "Standard 数据范围与稳定通道。": "Standard data scope and stable delivery channel.",
    "下载 Standard": "Download Standard",
    "Pro 数据范围与完整研究能力。": "Pro data scope and complete research capabilities.",
    "下载 Pro": "Download Pro",
    "刷新发行信息": "Refresh release information",
    "退出登录": "Sign out",
    "准备下载": "Preparing download",
    "等待连接下载服务。": "Waiting for the download service.",
    "账号状态概览": "Account status overview",
    "当前账号": "Current account",
    "未登录": "Signed out",
    "授权状态": "License status",
    "待激活": "Activation required",
    "License ID + 机器码绑定": "License ID + device fingerprint binding",
    "客户端": "Desktop client",
    "正在读取": "Loading",
    "数据同步": "Data sync",
    "等待桌面端": "Awaiting desktop app",
    "通过数据更新中心同步": "Sync through the Data Update Center",
    "账号操作": "Account actions",
    "账号登录": "Account sign in",
    "登录": "Sign in",
    "注册": "Register",
    "重置密码": "Reset password",
    "邮箱": "Email",
    "密码": "Password",
    "登录用户中心": "Sign in to your account",
    "用户名": "Name",
    "可选": "Optional",
    "验证码": "Verification code",
    "发送验证码": "Send code",
    "注册并登录": "Register and sign in",
    "新密码": "New password",
    "Workflow": "Workflow",
    "登录网站账号": "Sign in to your website account",
    "用于身份识别和下载入口。": "Used for identity and download access.",
    "绑定机器码": "Bind a device fingerprint",
    "从桌面端授权页面复制。": "Copy it from the desktop app's License page.",
    "回到桌面端同步": "Return to the desktop app to sync",
    "进入数据更新中心拉取数据。": "Use the Data Update Center to retrieve data.",
    "授权与设备": "License and device",
    "桌面端会生成本机机器码。复制机器码和激活码到这里完成绑定，随后桌面端即可使用同一账号同步 Cloudflare 数据。": "The desktop app generates a device fingerprint. Paste it here with an activation code to bind the device, then sync Cloudflare data with the same account.",
    "我的激活码": "My activation codes",
    "登录后读取激活码": "Sign in to load activation codes",
    "选择激活码后，将显示对应版本、授权状态和设备信息。": "Select an activation code to view its edition, license status, and device details.",
    "激活码": "Activation code",
    "例如 LIC-...": "For example, LIC-…",
    "机器码": "Device fingerprint",
    "从桌面端授权页面复制": "Copy from the desktop app's License page",
    "激活授权": "Activate license",
    "激活后自动填入，也可手动粘贴": "Filled after activation, or paste one manually",
    "检查授权状态": "Check license status",
    "桌面端数据同步": "Desktop data sync",
    "网站账号用于身份登录，License ID + 机器码用于设备授权。": "Your website account identifies you; the License ID and device fingerprint authorize the desktop app.",
    "桌面端“数据更新中心”会按模块拉取标的研究和市场上下文数据。": "The desktop app's Data Update Center retrieves asset research and market-context data by module.",
    "Standard / Pro 走同一条 Cloudflare 分发链路，只在字段和数据范围上区分。": "Standard and Pro share one Cloudflare delivery path; their fields and data scope differ.",
    "研究辅助工具，不构成投资建议。": "Research-support tool only. Not investment advice.",
    "已登录": "Signed in",
    "等待登录": "Awaiting sign in",
    "等待授权": "Awaiting license",
    "待绑定设备": "Device binding required",
    "可同步": "Ready to sync",
    "有效": "Valid",
    "异常": "Needs attention",
    "需要处理": "Needs attention",
    "不可下载": "Unavailable",
    "登录后加载": "Sign in to load",
    "暂无下载权益": "No download entitlement",
    "下载完成": "Download complete",
    "正在下载": "Downloading",
    "正在连接": "Connecting to",
    "安装包大小": "Installer size",
    "发布时间：": "Released: ",
    "当前版本": "Current edition",
    "已撤销": "Revoked",
    "待审核": "Pending review",
    "已拒绝": "Rejected",
    "授权有效": "License valid",
    "已使用": "Used",
    "状态未知": "Status unknown"
  };

  function translate(value) {
    if (typeof value !== "string" || !value) return value;
    let result = text[value] || value;
    if (result !== value) return result;
    Object.entries(text).forEach(([source, target]) => {
      if (source.length > 2 && result.includes(source)) result = result.replaceAll(source, target);
    });
    return result
      .replace(/正在下载\s*(\d+)%/g, "Downloading $1%")
      .replace(/(\d+) 个版本可下载/g, "$1 editions available")
      .replace(/有效期至\s*/g, "Valid until ")
      .replace(/已绑定设备/g, "Device bound")
      .replace(/未绑定设备/g, "Device not bound");
  }

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const translated = translate(node.nodeValue);
      if (translated !== node.nodeValue) node.nodeValue = translated;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches("script, style")) return;
    ["aria-label", "placeholder", "title"].forEach((attribute) => {
      if (!node.hasAttribute(attribute)) return;
      const current = node.getAttribute(attribute);
      const translated = translate(current);
      if (translated !== current) node.setAttribute(attribute, translated);
    });
    node.childNodes.forEach(translateNode);
  }

  function localizeLinks() {
    document.querySelector(".brand").href = "index-en.html";
    document.querySelectorAll("nav a").forEach((link) => {
      if (link.getAttribute("href")?.startsWith("index-cn.html")) {
        link.href = link.getAttribute("href").replace("index-cn.html", "index-en.html");
      }
      if (link.getAttribute("href") === "feedback-cn.html") link.href = "feedback-en.html";
      if (link.getAttribute("href") === "faq-cn.html") link.href = "faq-en.html";
      if (link.getAttribute("href") === "account.html") link.href = "account.html?lang=en";
    });
    const links = document.querySelectorAll(".lang-switch a");
    if (links.length === 2) {
      links[0].classList.remove("active");
      links[0].href = "account.html";
      links[1].classList.add("active");
      links[1].href = "account.html?lang=en";
    }
  }

  document.documentElement.lang = "en";
  document.title = text[document.title] || "Account | Scorpio Intelligence";
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = text[description.content] || description.content;
  window.scorpioTranslate = translate;
  localizeLinks();
  translateNode(document.body);

  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "characterData") translateNode(mutation.target);
      mutation.addedNodes.forEach(translateNode);
      if (mutation.type === "attributes") translateNode(mutation.target);
    });
  }).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "placeholder", "title"]
  });
})();
