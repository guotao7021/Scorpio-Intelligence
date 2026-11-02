CREATE INDEX IF NOT EXISTS idx_licenses_activation_code_revoked
  ON licenses (activation_code_id, revoked);
