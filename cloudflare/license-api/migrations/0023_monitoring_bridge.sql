-- Private monitoring transport. No portfolio rows, trade instructions or push tokens.
CREATE TABLE IF NOT EXISTS monitoring_links (
 link_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, desktop_license TEXT NOT NULL,
 desktop_fingerprint TEXT NOT NULL, instance_id TEXT NOT NULL, account_scope TEXT NOT NULL CHECK(account_scope IN ('paper','live')),
 code_hash TEXT NOT NULL UNIQUE, code_expires TEXT NOT NULL, mobile_fingerprint TEXT,
 mobile_license TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_sync_at TEXT
);
CREATE INDEX IF NOT EXISTS monitoring_links_owner ON monitoring_links(user_id, desktop_fingerprint, instance_id);
CREATE TABLE IF NOT EXISTS monitoring_cloud_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, link_id TEXT NOT NULL, event_id TEXT NOT NULL,
 payload TEXT NOT NULL, content_hash TEXT NOT NULL, received_at TEXT NOT NULL,
 UNIQUE(link_id,event_id), FOREIGN KEY(link_id) REFERENCES monitoring_links(link_id)
);
CREATE TABLE IF NOT EXISTS monitoring_cloud_reads (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, link_id TEXT NOT NULL, event_id TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('desktop','mobile')), read_at TEXT NOT NULL,
 UNIQUE(link_id,event_id,origin)
);
