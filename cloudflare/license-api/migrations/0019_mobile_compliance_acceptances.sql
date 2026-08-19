CREATE TABLE IF NOT EXISTS mobile_compliance_acceptances (
  user_id INTEGER NOT NULL,
  compliance_version TEXT NOT NULL,
  machine_fingerprint TEXT NOT NULL,
  client_version TEXT NOT NULL DEFAULT '',
  client_ip TEXT NOT NULL DEFAULT '',
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, compliance_version, machine_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_mobile_compliance_acceptances_user
  ON mobile_compliance_acceptances (user_id, compliance_version, accepted_at DESC);
