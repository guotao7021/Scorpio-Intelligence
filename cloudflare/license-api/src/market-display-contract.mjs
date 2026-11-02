// Same reading contract as analysis/market_display_contract.py; shared JSON fixtures.
export const VERSION = "market-display.v1";
export function businessDate(value) {
  let text = String(value ?? "").trim();
  if (/^\d{8}$/.test(text)) text = `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6)}`;
  if (!/^\d{4}-\d{2}-\d{2}($|[ T])/.test(text)) return null;
  const day = text.slice(0,10);
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === day ? day : null;
}
export function observedNumber(value) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function dateScope(rows = []) {
  rows = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === "object" && !Array.isArray(r));
  const dates = rows.map(r => businessDate(r.trade_date || r.date || r._data_date));
  const valid = [...new Set(dates.filter(Boolean))].sort();
  return {start: valid[0] || null, end: valid.at(-1) || null, missing_count: dates.filter(d => !d).length, row_count: rows.length};
}
export function resolveMarketScore(payload) {
  const mapping = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
  payload = mapping(payload);
  const regime = Object.keys(mapping(payload.sections?.regime)).length ? mapping(payload.sections.regime) : mapping(payload.regime);
  const summary = mapping(payload.summary);
  let owner, key, source;
  if ("market_score" in regime) [owner,key,source] = [regime,"market_score","sections.regime.market_score"];
  else if ("market_score" in payload) [owner,key,source] = [payload,"market_score","market_score"];
  else [owner,key,source] = [summary,"score","summary.score"];
  let value = observedNumber(owner[key]);
  if (value !== null && (value < 0 || value > 100) || /sentiment/i.test(`${owner.score_source || ""} ${owner.score_version || ""}`)) value = null;
  const quality = mapping(owner.score_input_quality);
  const day = businessDate(owner.formal_close_snapshot?.business_date || owner.effective_trade_date || owner.business_date || owner.trade_date);
  let status = value === null ? "missing" : String(owner.score_status || "ready");
  if (value !== null && quality.blockers?.length) status = "blocked";
  const alternate = observedNumber(summary.score);
  return {contract_version: VERSION, value, status, business_date: day,
    source: String(owner.score_source || source), score_version: owner.score_version || null,
    summary_conflict: source !== "summary.score" && alternate !== null && value !== null && alternate !== value};
}
