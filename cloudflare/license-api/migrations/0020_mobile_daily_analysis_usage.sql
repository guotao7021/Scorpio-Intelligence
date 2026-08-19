CREATE TABLE IF NOT EXISTS mobile_daily_analysis_usage (
  user_id INTEGER NOT NULL,
  usage_date TEXT NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_mobile_daily_analysis_usage_date
  ON mobile_daily_analysis_usage (usage_date, updated_at);
