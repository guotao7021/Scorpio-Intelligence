// Mirrors the versioned Python trap catalogs; detectors remain in the producer.
export const TRAP_CATALOG = [
  {
    "id": "gap_up_vwap_failure",
    "title": "高开冲高后失守均价",
    "implemented": true
  },
  {
    "id": "intraday_impulse_reversal",
    "title": "分钟急拉后快速回撤",
    "implemented": true
  },
  {
    "id": "late_session_price_dislocation",
    "title": "尾盘价格偏离且缺少承接",
    "implemented": true
  },
  {
    "id": "limit_up_fragility",
    "title": "涨停或高位封板脆弱",
    "implemented": true
  },
  {
    "id": "relative_strength_breadth_divergence",
    "title": "个股强势与板块宽度背离",
    "implemented": true
  },
  {
    "id": "liquidity_shock_reversal",
    "title": "流动性冲击后的短周期反转",
    "implemented": true
  },
  {
    "id": "salience_lottery_risk",
    "title": "极端收益显著性与投机拥挤",
    "implemented": true
  },
  {
    "id": "retreat_countertrend_pulse",
    "title": "退潮环境中的逆势脉冲",
    "implemented": true
  },
  {
    "id": "spoofing_like_cancellation",
    "title": "大额申报后频繁撤单",
    "implemented": false
  },
  {
    "id": "frequent_price_pressure_orders",
    "title": "短时连续拉抬或打压申报",
    "implemented": false
  },
  {
    "id": "limit_price_maintenance_orders",
    "title": "维持涨跌停价格的申报行为",
    "implemented": false
  },
  {
    "id": "self_trade_or_counterparty_pattern",
    "title": "自买自卖或互为对手方交易",
    "implemented": false
  },
  {
    "id": "resistance_breakout_failure",
    "title": "突破阻力后回落失守",
    "implemented": true
  },
  {
    "id": "support_breakdown_reclaim",
    "title": "跌破支持后收复（假跌破）",
    "implemented": true
  },
  {
    "id": "vwap_reclaim_failure",
    "title": "重返VWAP后再次失守",
    "implemented": true
  },
  {
    "id": "breakout_retest_failure",
    "title": "突破后回踩承接失败",
    "implemented": true
  },
  {
    "id": "low_volume_breakout",
    "title": "突破缺少成交量确认",
    "implemented": true
  },
  {
    "id": "price_volume_divergence",
    "title": "价格创新高但量能未确认",
    "implemented": true
  },
  {
    "id": "oscillator_extreme_trend_trap",
    "title": "超买超卖钝化的反转误判",
    "implemented": true
  },
  {
    "id": "squeeze_breakout_failure",
    "title": "波动收缩后突破失败",
    "implemented": true
  },
  {
    "id": "order_message_rate_anomaly",
    "title": "短时申报速率异常",
    "implemented": false
  },
  {
    "id": "t1_locked_exit_risk",
    "title": "新买仓位触发退出但T+1不可卖",
    "implemented": true
  }
];
