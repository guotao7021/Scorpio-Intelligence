-- Overview/Market read one exact-day publication head. Keep the lookup bounded
-- without changing immutable publications, revocations or release authority.
CREATE INDEX IF NOT EXISTS idx_minute_beta_market_day
  ON minute_beta_publications(business_date, published_at DESC, seq DESC, code);
CREATE INDEX IF NOT EXISTS idx_minute_delivery_market_day
  ON minute_delivery_publications(business_date, published_at DESC, seq DESC, code);
