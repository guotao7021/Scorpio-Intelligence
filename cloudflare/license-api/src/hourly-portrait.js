// Descriptive public OHLCV facts only. Mirror commercial/hourly_presentation.py.
export function hourlyPortrait(bars, { availableAt = "", incomplete = false } = {}) {
  const intervals = [...bars].sort((a, b) => a.bar_time.localeCompare(b.bar_time))
    .filter((b) => b.bar_time.slice(11, 16) !== "09:30");
  const base = { schema_version: "hourly-display.v1", interval_minutes: 60,
    data_source: "tushare.stk_mins", price_basis: "unadjusted", available_at: availableAt,
    title: "60分钟走势画像", status: "unavailable", start_at: "", end_at: "",
    session_count: 0, bar_count: bars.length, interval_count: intervals.length, items: [], metrics: {} };
  if (intervals.length < 2) return { ...base, summary: "小时行情样本不足，暂时无法生成走势画像。" };
  if (intervals.some((b) => ["open", "high", "low", "close", "volume"].some((k) =>
    !Number.isFinite(b[k]) || b[k] < 0) || b.close <= 0)) throw new Error("invalid_hourly_portrait_values");
  const closes = intervals.map((b) => b.close);
  let peak = closes[0], drawdown = 0;
  for (const close of closes) { peak = Math.max(peak, close); drawdown = Math.max(drawdown, (1 - close / peak) * 100); }
  const volumes = new Map();
  for (const bar of intervals) { const day = bar.bar_time.slice(0, 10); volumes.set(day, (volumes.get(day) || 0) + bar.volume); }
  const average = [...volumes.values()].reduce((a, b) => a + b, 0) / volumes.size;
  const intradayPairs = intervals.slice(1).map((b, i) => [intervals[i], b])
    .filter(([a, b]) => a.bar_time.slice(0, 10) === b.bar_time.slice(0, 10));
  const metrics = { window_change_pct: (closes.at(-1) / closes[0] - 1) * 100,
    high: Math.max(...intervals.map((b) => b.high)), low: Math.min(...intervals.map((b) => b.low)),
    close_drawdown_pct: drawdown,
    rising_interval_pct: intradayPairs.length ? intradayPairs.filter(([a, b]) => b.close > a.close).length / intradayPairs.length * 100 : null,
    latest_volume_ratio: average > 0 ? volumes.get([...volumes.keys()].sort().at(-1)) / average : null };
  const items = [
    { label: "展示期涨跌", value: `${metrics.window_change_pct >= 0 ? "+" : ""}${metrics.window_change_pct.toFixed(2)}%`, note: "整个展示期间首末小时收盘比较，不是账户收益" },
    { label: "窗口价格范围", value: `${metrics.low.toFixed(2)}—${metrics.high.toFixed(2)}`, note: "完整小时区间高低价" },
    { label: "收盘最大回撤", value: `${drawdown.toFixed(2)}%`, note: "小时收盘序列，不含盘中极值或交易成本" },
    { label: "日内上涨区间占比", value: intradayPairs.length ? `${metrics.rising_interval_pct.toFixed(2)}%` : "--", note: "仅同一交易日相邻完整小时比较，不含隔夜跳变；非策略胜率" },
    { label: "最近日成交量比", value: average > 0 ? `${metrics.latest_volume_ratio.toFixed(2)}倍` : "--", note: "最近完整交易日成交量 / 展示期日均成交量" },
  ];
  return { ...base, status: incomplete ? "partial" : "available", start_at: intervals[0].bar_time,
    end_at: intervals.at(-1).bar_time, session_count: volumes.size, metrics, items,
    summary: "历史行情统计仅供观察，不构成买卖建议；不复权价格可能受除权除息影响。" };
}
