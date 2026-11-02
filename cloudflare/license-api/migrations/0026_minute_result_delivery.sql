-- Read-only explanation delivery is separate from production decisions and
-- generic table uploads. Candidates never become visible without admin approval.
CREATE TABLE IF NOT EXISTS minute_delivery_candidates (
  candidate_id TEXT PRIMARY KEY, code TEXT NOT NULL, business_date TEXT NOT NULL,
  generated_at TEXT NOT NULL, candidate_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
  registered_by TEXT NOT NULL, registered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS minute_delivery_approvals (
  approval_id TEXT PRIMARY KEY, publication_id TEXT NOT NULL UNIQUE,
  candidate_id TEXT NOT NULL REFERENCES minute_delivery_candidates(candidate_id),
  approval_hash TEXT NOT NULL, manifest_json TEXT NOT NULL,
  approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS minute_delivery_publications (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, publication_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL, business_date TEXT NOT NULL,
  approval_id TEXT NOT NULL UNIQUE REFERENCES minute_delivery_approvals(approval_id),
  publication_hash TEXT NOT NULL, envelope_json TEXT NOT NULL,
  published_by TEXT NOT NULL, published_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_minute_delivery_latest
  ON minute_delivery_publications(code, business_date, seq DESC);
CREATE TABLE IF NOT EXISTS minute_delivery_revocations (
  publication_id TEXT PRIMARY KEY REFERENCES minute_delivery_publications(publication_id),
  revoked_by TEXT NOT NULL, revoked_at TEXT NOT NULL, reason TEXT NOT NULL
);
-- Approved payloads and withdrawal tombstones are append-only.
CREATE TRIGGER IF NOT EXISTS minute_candidates_no_update BEFORE UPDATE ON minute_delivery_candidates BEGIN SELECT RAISE(ABORT,'immutable_minute_candidate'); END;
CREATE TRIGGER IF NOT EXISTS minute_candidates_no_delete BEFORE DELETE ON minute_delivery_candidates BEGIN SELECT RAISE(ABORT,'immutable_minute_candidate'); END;
CREATE TRIGGER IF NOT EXISTS minute_approvals_no_update BEFORE UPDATE ON minute_delivery_approvals BEGIN SELECT RAISE(ABORT,'immutable_minute_approval'); END;
CREATE TRIGGER IF NOT EXISTS minute_approvals_no_delete BEFORE DELETE ON minute_delivery_approvals BEGIN SELECT RAISE(ABORT,'immutable_minute_approval'); END;
CREATE TRIGGER IF NOT EXISTS minute_publications_no_update BEFORE UPDATE ON minute_delivery_publications BEGIN SELECT RAISE(ABORT,'immutable_minute_publication'); END;
CREATE TRIGGER IF NOT EXISTS minute_publications_no_delete BEFORE DELETE ON minute_delivery_publications BEGIN SELECT RAISE(ABORT,'immutable_minute_publication'); END;
CREATE TRIGGER IF NOT EXISTS minute_revocations_no_update BEFORE UPDATE ON minute_delivery_revocations BEGIN SELECT RAISE(ABORT,'immutable_minute_revocation'); END;
CREATE TRIGGER IF NOT EXISTS minute_revocations_no_delete BEFORE DELETE ON minute_delivery_revocations BEGIN SELECT RAISE(ABORT,'immutable_minute_revocation'); END;
