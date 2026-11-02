ALTER TABLE users ADD COLUMN archived_at TEXT;
ALTER TABLE users ADD COLUMN record_operation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE activation_codes ADD COLUMN archived_at TEXT;
ALTER TABLE activation_codes ADD COLUMN record_operation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE licenses ADD COLUMN archived_at TEXT;
ALTER TABLE licenses ADD COLUMN record_operation_id TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_users_archived ON users(archived_at, id);
CREATE INDEX idx_codes_archived ON activation_codes(archived_at, id);
CREATE INDEX idx_licenses_archived ON licenses(archived_at, user_id);
