-- Detailed queries and their read-only refreshes share the existing daily quota.
-- A grant is account/day/stock specific; the phone cannot declare sample access.
CREATE TABLE IF NOT EXISTS mobile_stock_read_grants (
  user_id INTEGER NOT NULL,
  usage_date TEXT NOT NULL,
  code TEXT NOT NULL CHECK(length(code) = 6 AND code NOT GLOB '*[^0-9]*'),
  license_id TEXT NOT NULL,
  quota_limit INTEGER NOT NULL CHECK(quota_limit > 0),
  granted_at TEXT NOT NULL,
  PRIMARY KEY(user_id, usage_date, code)
);

-- Check and increment inside the same insertion transaction, including races
-- across Worker isolates. Retrying the same stock is not charged again.
CREATE TRIGGER IF NOT EXISTS mobile_stock_grant_quota_check
BEFORE INSERT ON mobile_stock_read_grants
WHEN NOT EXISTS(SELECT 1 FROM mobile_stock_read_grants
  WHERE user_id=NEW.user_id AND usage_date=NEW.usage_date AND code=NEW.code)
AND COALESCE((SELECT used_count FROM mobile_daily_analysis_usage
  WHERE user_id=NEW.user_id AND usage_date=NEW.usage_date), 0) >= NEW.quota_limit
BEGIN
  SELECT RAISE(ABORT, 'mobile_daily_analysis_limit_reached');
END;

CREATE TRIGGER IF NOT EXISTS mobile_stock_grant_quota_charge
AFTER INSERT ON mobile_stock_read_grants
BEGIN
  INSERT INTO mobile_daily_analysis_usage(user_id, usage_date, used_count, updated_at)
  VALUES(NEW.user_id, NEW.usage_date, 1, NEW.granted_at)
  ON CONFLICT(user_id, usage_date) DO UPDATE SET
    used_count=mobile_daily_analysis_usage.used_count+1,
    updated_at=excluded.updated_at;
END;
