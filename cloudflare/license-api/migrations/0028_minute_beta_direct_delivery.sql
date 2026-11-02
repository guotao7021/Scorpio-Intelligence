-- Beta display results have a single publish operation, not a candidate or
-- approval workflow. Formal MCOS/production release records remain unchanged.
CREATE TABLE IF NOT EXISTS minute_beta_publications (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, publication_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL, business_date TEXT NOT NULL, generated_at TEXT NOT NULL,
  request_hash TEXT NOT NULL, publication_hash TEXT NOT NULL,
  envelope_json TEXT NOT NULL, policy_json TEXT NOT NULL,
  published_by TEXT NOT NULL, published_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_minute_beta_latest
  ON minute_beta_publications(code, business_date, seq DESC);
CREATE TABLE IF NOT EXISTS minute_beta_revocations (
  publication_id TEXT PRIMARY KEY REFERENCES minute_beta_publications(publication_id),
  revoked_by TEXT NOT NULL, revoked_at TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS minute_beta_no_update BEFORE UPDATE ON minute_beta_publications BEGIN SELECT RAISE(ABORT,'immutable_minute_beta_publication'); END;
CREATE TRIGGER IF NOT EXISTS minute_beta_no_delete BEFORE DELETE ON minute_beta_publications BEGIN SELECT RAISE(ABORT,'immutable_minute_beta_publication'); END;
CREATE TRIGGER IF NOT EXISTS minute_beta_revocations_no_update BEFORE UPDATE ON minute_beta_revocations BEGIN SELECT RAISE(ABORT,'immutable_minute_beta_revocation'); END;
CREATE TRIGGER IF NOT EXISTS minute_beta_revocations_no_delete BEFORE DELETE ON minute_beta_revocations BEGIN SELECT RAISE(ABORT,'immutable_minute_beta_revocation'); END;
