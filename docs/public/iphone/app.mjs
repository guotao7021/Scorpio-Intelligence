import { MobileSession, describeError, loadAuthSiteKey } from "./cloud.mjs";

const $ = id => document.getElementById(id);
const asRows = value => Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
const value = item => typeof item === "number" && Number.isFinite(item) ? String(item) : typeof item === "string" && item.trim() ? item.trim() : "—";
const usable = item => !["—", "--", "-", "暂无"].includes(value(item));
const percent = item => typeof item === "number" && Number.isFinite(item) ? (item > 0 ? "+" : "") + item.toFixed(2) + "%" : value(item);
const direction = item => parseFloat(item) > 0 ? "up" : parseFloat(item) < 0 ? "down" : "";
const session = new MobileSession();
const isIPhone = /iPhone|iPod/i.test(navigator.userAgent);
let home;
let compliance;
let marketSnapshot;
let activeView = "overview";
let revision = 0;
let challengeId = null;
let challengeToken = "";
let loadingChallenge = false;
let signingIn = false;

function updateLogin() {
  $("sign-in").disabled = signingIn || !challengeToken;
}

async function loadChallengeScript() {
  if (window.turnstile) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error("challenge_unavailable"));
    };
    const timer = setTimeout(fail, 12000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = fail;
    document.head.append(script);
  });
}

async function prepareChallenge() {
  if (loadingChallenge) return;
  loadingChallenge = true;
  challengeToken = "";
  updateLogin();
  $("challenge-status").textContent = "正在加载安全验证…";
  $("challenge-retry").hidden = true;
  const fail = () => {
    challengeToken = "";
    updateLogin();
    $("challenge-status").textContent = "安全验证暂不可用或已失效。";
    $("challenge-retry").hidden = false;
  };
  try {
    if (challengeId !== null) {
      window.turnstile.reset(challengeId);
      return;
    }
    const sitekey = await loadAuthSiteKey();
    await loadChallengeScript();
    challengeId = window.turnstile.render($("login-challenge"), {
      sitekey, action: "auth_login", theme: "dark", size: "flexible", language: "zh-cn",
      "response-field": false,
      callback(token) {
        challengeToken = token;
        updateLogin();
        $("challenge-status").textContent = "";
        $("challenge-retry").hidden = true;
      },
      "expired-callback": fail, "error-callback": fail, "timeout-callback": fail,
    });
  } catch {
    fail();
  } finally {
    loadingChallenge = false;
  }
}

function node(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined) el.textContent = content;
  return el;
}

function button(label, handler) {
  const el = node("button", "quiet", label);
  el.type = "button";
  el.addEventListener("click", handler);
  return el;
}

function heading(label, action) {
  const title = node("div", "titleline");
  title.append(node("h1", "", label));
  if (action) title.append(action);
  return title;
}

function card(title, ...content) {
  const el = node("article", "card");
  el.append(node("h2", "", title), ...content);
  return el;
}

function row(label, data, tone = "") {
  const el = node("div", "row");
  el.append(node("span", "", label), node("strong", tone, value(data)));
  return el;
}

function tiles(items) {
  const list = node("div", "tiles");
  for (const [label, reading, tone, note] of items) {
    const el = node("div", "tile");
    el.append(node("span", "", value(label)), node("strong", tone, value(reading)));
    if (usable(note)) el.append(node("small", "", value(note)));
    list.append(el);
  }
  return list;
}

function indexCard(items) {
  const indices = asRows(items).slice(0, 6);
  return card("主要指数", indices.length ? tiles(indices.map(item => [
    item.name, percent(item.pct_today), direction(percent(item.pct_today)), item.close,
  ])) : node("p", "subtle", "暂无已发布指数数据。"));
}

function show(page) {
  $("welcome").hidden = page !== "login";
  $("notice").hidden = page !== "notice";
  $("workspace").hidden = page !== "workspace";
  $("account-controls").hidden = page === "login";
  $("edition").textContent = page === "login" ? "" : session.edition;
}

function acceptBootstrap(result) {
  home = result.home;
  compliance = result.compliance;
  if (compliance.required && !compliance.accepted) {
    const sections = asRows(compliance.sections);
    const content = $("notice-content");
    content.replaceChildren();
    for (const section of sections) {
      const details = node("details");
      details.append(node("summary", "", value(section.title)));
      const body = section.body ?? section.content ?? section.text;
      if (typeof body === "string") details.append(node("p", "", body));
      else if (Array.isArray(body)) {
        for (const line of body) if (typeof line === "string") details.append(node("p", "", line));
      }
      details.open = !content.childElementCount;
      content.append(details);
    }
    if (!content.querySelector("p")) {
      for (const key of ["investment_notice", "data_delay_notice", "privacy_notice"]) {
        if (usable(compliance[key])) content.append(node("p", "subtle", value(compliance[key])));
      }
    }
    const readable = [...content.querySelectorAll("p")].some(el => usable(el.textContent));
    $("accept").disabled = !readable || !usable(compliance.version);
    $("notice-status").textContent = $("accept").disabled ? "暂时无法读取完整使用须知，请重新载入。" : "";
    show("notice");
    return;
  }
  show("workspace");
  selectView("overview");
}

function clearSession(message = "") {
  revision++;
  session.logout();
  home = compliance = marketSnapshot = undefined;
  $("password").value = "";
  $("screen").replaceChildren();
  $("workspace-status").textContent = "";
  $("login-status").textContent = message;
  show("login");
  prepareChallenge();
}

function viewError(error, target) {
  if (error.status === 401) {
    clearSession("登录已过期，请重新登录。");
    return;
  }
  target.textContent = describeError(error);
}

function selectView(view) {
  activeView = view;
  const current = ++revision;
  for (const item of $("navigation").querySelectorAll("button")) {
    if (item.dataset.view === view) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  $("workspace-status").textContent = "";
  if (view === "overview") {
    const date = usable(home.data_date) ? "数据日 · " + value(home.data_date) : "数据日待更新";
    $("screen").replaceChildren(
      heading("投研概览"),
      card("今日市场", node("span", "badge", date),
        node("h2", "", usable(home.market_state) ? value(home.market_state) : "市场结论待更新"),
        node("p", "subtle", usable(home.market_detail) ? value(home.market_detail) : "待市场数据发布后可查看。"),
        button("查看市场", () => selectView("market"))),
      indexCard(home.indices),
    );
  } else if (view === "market") {
    void showMarket(current);
  } else {
    showSearch(current);
  }
}

async function showMarket(current, refresh = false) {
  const refreshButton = button("刷新", () => {
    $("workspace-status").textContent = "";
    void showMarket(++revision, true);
  });
  $("screen").replaceChildren(heading("市场", refreshButton));
  refreshButton.disabled = true;
  if (!marketSnapshot || refresh) $("workspace-status").textContent = "正在读取市场数据…";
  try {
    const market = marketSnapshot && !refresh ? marketSnapshot : (await session.read("/v1/mobile/market")).market;
    if (current !== revision) return;
    if (!market || typeof market !== "object") throw Error("Missing market");
    marketSnapshot = market;
    const overview = market.overview || {};
    const breadth = market.breadth || {};
    const date = usable(market.data_dates?.score) ? value(market.data_dates.score) : "待更新";
    const sectors = asRows(market.sectors).slice(0, 6);
    const fields = [
      heading("市场", refreshButton),
      card("盘后研判", node("span", "badge", "数据日 · " + date), tiles([
        ["市场阶段", overview.phase], ["市场评分", overview.score_label], ["风险等级", overview.risk_label],
        ["上涨家数", breadth.up_count], ["下跌家数", breadth.down_count],
      ])),
      indexCard(market.indices),
    ];
    if (sectors.length && ["available", "partial"].includes(market.sector_heat_meta?.status) && usable(market.sector_heat_meta?.business_date)) {
      fields.push(card("行业热度", node("p", "subtle", "数据日 · " + value(market.sector_heat_meta.business_date)),
        ...sectors.map(item => row(value(item.name), percent(item.change), direction(percent(item.change))))));
    }
    $("screen").replaceChildren(...fields);
    $("workspace-status").textContent = "";
  } catch (error) {
    if (current === revision) viewError(error, $("workspace-status"));
  } finally {
    refreshButton.disabled = false;
  }
}

function showSearch(current, keyword = "") {
  const search = node("form", "search");
  search.setAttribute("role", "search");
  const input = node("input");
  input.id = "stock-keyword";
  input.type = "search";
  input.maxLength = 64;
  input.required = true;
  input.value = keyword;
  input.placeholder = "例如 600519";
  const label = node("label", "", "股票代码或名称");
  label.htmlFor = input.id;
  const submit = node("button", "primary", "搜索");
  submit.type = "submit";
  const results = node("div", "results");
  search.append(label, input, submit);
  search.addEventListener("submit", async event => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query || current !== revision || submit.disabled) return;
    submit.disabled = true;
    results.replaceChildren();
    $("workspace-status").textContent = "正在搜索标的…";
    try {
      const response = await session.read("/v1/mobile/stock/search", { keyword: query });
      if (current !== revision) return;
      const items = asRows(response.items).filter(item => usable(item.code));
      if (!items.length) results.append(node("p", "subtle", "没有找到匹配的股票。"));
      for (const item of items) {
        const el = button(value(item.name), () => void showStock(item, query, ++revision));
        el.className = "result";
        el.append(node("small", "", [item.code, item.industry].filter(usable).join(" · ")));
        results.append(el);
      }
      $("workspace-status").textContent = "";
    } catch (error) {
      if (current === revision) viewError(error, $("workspace-status"));
    } finally {
      submit.disabled = false;
    }
  });
  $("screen").replaceChildren(heading("标的"), card("搜索 A 股", search, results));
}

function dailyChart(trend) {
  const values = Array.isArray(trend?.values) ? trend.values.slice(-60) : [];
  const dates = Array.isArray(trend?.dates) ? trend.dates.slice(-60) : [];
  const numbers = values.filter(item => typeof item === "number" && Number.isFinite(item));
  if (numbers.length < 2) return card("日线走势", node("p", "subtle", "暂无已发布的日线数据。"));
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const points = [];
  let path = "";
  for (const [i, reading] of values.entries()) {
    if (typeof reading !== "number" || !Number.isFinite(reading)) {
      path = "";
      continue;
    }
    const x = 8 + i * 304 / (values.length - 1);
    const y = high === low ? 58 : 106 - (reading - low) * 96 / (high - low);
    const coordinate = (path ? "L " : "M ") + x.toFixed(2) + " " + y.toFixed(2);
    points.push(coordinate);
    path = coordinate;
  }
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("class", "chart");
  svg.setAttribute("viewBox", "0 0 320 116");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "最近 " + numbers.length + " 个有效日线收盘价，最低 " + low + "，最高 " + high);
  const line = document.createElementNS(namespace, "path");
  line.setAttribute("d", points.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#38bdf8");
  line.setAttribute("stroke-width", "2");
  svg.append(line);
  const scale = node("div", "chart-labels");
  scale.append(node("span", "", value(dates[0])), node("span", "", value(dates.at(-1))));
  return card("日线收盘走势", svg, scale);
}

async function showStock(item, query, current) {
  const back = button("返回搜索", () => {
    $("workspace-status").textContent = "";
    showSearch(++revision, query);
  });
  $("screen").replaceChildren(heading(value(item.name), back));
  $("workspace-status").textContent = "正在读取标的详情…";
  try {
    const result = (await session.read("/v1/mobile/stock/research", { code: item.code })).research;
    if (current !== revision || activeView !== "stocks") return;
    if (!result || typeof result !== "object") throw Error("Missing stock");
    const data = result.header || {};
    const name = usable(result.name) ? value(result.name) : value(item.name);
    const period = [item.code, result.industry || item.industry, result.as_of].filter(usable).join(" · ");
    const price = data.price ?? data.price_label ?? data.latest_price ?? result.trend?.latest_price;
    const change = percent(data.change ?? data.change_label ?? data.pct_change);
    $("screen").replaceChildren(
      heading(name, back),
      card("行情摘要", node("p", "subtle", period), tiles([
        ["最新价", price], ["涨跌幅", change, direction(change)], ["复盘评分", data.score_label],
      ])),
      dailyChart(result.trend),
      card("研究结论", node("p", "", usable(result.conclusion?.summary) ? value(result.conclusion.summary) : "暂无可展示的研究结论。")),
    );
    $("workspace-status").textContent = result.state === "partial" ? "部分数据待发布。" : "";
  } catch (error) {
    if (current === revision) viewError(error, $("workspace-status"));
  }
}

$("login").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isIPhone || $("sign-in").disabled) return;
  signingIn = true;
  const token = challengeToken;
  challengeToken = "";
  updateLogin();
  const password = $("password").value;
  $("password").value = "";
  $("login-status").textContent = "正在登录…";
  try {
    acceptBootstrap(await session.login($("email").value.trim(), password, token));
    $("login-status").textContent = "";
  } catch (error) {
    clearSession(describeError(error));
  } finally {
    signingIn = false;
    updateLogin();
  }
});

$("challenge-retry").addEventListener("click", prepareChallenge);

$("accept").addEventListener("click", async () => {
  $("accept").disabled = true;
  $("notice-status").textContent = "正在确认…";
  const current = revision;
  try {
    const response = await session.read("/v1/mobile/compliance/accept", { compliance_version: compliance.version });
    if (current !== revision) return;
    if (response.compliance?.accepted !== true || response.compliance.version !== compliance.version) throw Error("Notice not accepted");
    acceptBootstrap({ home, compliance: response.compliance });
  } catch (error) {
    if (current === revision) viewError(error, $("notice-status"));
  } finally {
    $("accept").disabled = false;
  }
});

$("logout").addEventListener("click", () => clearSession());
$("navigation").addEventListener("click", event => {
  const control = event.target.closest("button[data-view]");
  if (control) selectView(control.dataset.view);
});

if (isIPhone) {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) $("install").hidden = true;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  session.restore().then(result => { if (result) acceptBootstrap(result); })
    .catch(error => { $("login-status").textContent = describeError(error); session.logout(); })
    .finally(() => { if (!$("welcome").hidden) prepareChallenge(); });
} else {
  $("login").hidden = true;
  $("unsupported").hidden = false;
}
