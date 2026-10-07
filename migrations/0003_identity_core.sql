-- Phase 26: identity core and tenant isolation
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  email_display TEXT NOT NULL,
  email_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_changed_at TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  verifier_hash TEXT NOT NULL,
  csrf_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON user_sessions(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_email_verification_user
  ON email_verification_tokens(user_id, expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user
  ON password_reset_tokens(user_id, expires_at);

CREATE TABLE IF NOT EXISTS external_connections (
  connection_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT,
  display_name TEXT,
  display_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_sync_status TEXT,
  revoked_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(user_id),
  UNIQUE(user_id, provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_external_connections_user
  ON external_connections(user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS external_credentials (
  connection_id TEXT PRIMARY KEY,
  credential_version INTEGER NOT NULL DEFAULT 1,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(connection_id) REFERENCES external_connections(connection_id)
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  connection_id TEXT PRIMARY KEY,
  cursor_value TEXT,
  state TEXT NOT NULL DEFAULT 'idle',
  last_started_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(connection_id) REFERENCES external_connections(connection_id)
);

CREATE TABLE IF NOT EXISTS security_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_security_events_user
  ON security_events(user_id, created_at);

ALTER TABLE objects ADD COLUMN user_id TEXT;
ALTER TABLE objects ADD COLUMN connection_id TEXT;
CREATE INDEX IF NOT EXISTS idx_objects_user
  ON objects(user_id, created_at);

ALTER TABLE items ADD COLUMN user_id TEXT;
ALTER TABLE items ADD COLUMN connection_id TEXT;
CREATE INDEX IF NOT EXISTS idx_items_user
  ON items(user_id, created_at);

ALTER TABLE memories ADD COLUMN user_id TEXT;
ALTER TABLE memories ADD COLUMN connection_id TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_user
  ON memories(user_id, created_at);

ALTER TABLE projects ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects(user_id, created_at);

ALTER TABLE inbox ADD COLUMN user_id TEXT;
ALTER TABLE inbox ADD COLUMN connection_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inbox_user
  ON inbox(user_id, received_at);
