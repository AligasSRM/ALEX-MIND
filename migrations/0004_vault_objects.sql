-- Canonical D1 index for objects stored in the physical vault.
-- IF NOT EXISTS keeps this compatible with environments where the table
-- was provisioned before migrations were fully represented in the repository.
CREATE TABLE IF NOT EXISTS objects (
  object_id TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL,
  vault_id TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stored',
  name TEXT,
  kind TEXT NOT NULL DEFAULT 'file',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL,
  checksum_algorithm TEXT NOT NULL DEFAULT 'SHA-256',
  external_id TEXT,
  project_slug TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  archived_at TEXT,
  trashed_at TEXT,
  FOREIGN KEY(source_id) REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS idx_objects_status_updated
  ON objects(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_objects_vault_updated
  ON objects(vault_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_objects_storage_key
  ON objects(storage_provider, storage_bucket, storage_key);