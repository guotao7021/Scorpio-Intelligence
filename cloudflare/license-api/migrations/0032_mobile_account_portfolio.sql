-- Private mobile account inputs. Never part of production_table_rows/public archives.
CREATE TABLE IF NOT EXISTS mobile_account_portfolios (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL DEFAULT '{}',
  input_hash TEXT NOT NULL DEFAULT '',
  request_key TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mobile_account_portfolio_revisions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  input_json TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(user_id,revision),
  UNIQUE(user_id,request_key)
);
CREATE TABLE IF NOT EXISTS mobile_account_portfolio_plans (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  analysis_key TEXT NOT NULL,
  scenario_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(user_id,plan_id)
);
