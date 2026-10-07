CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_policies (
  source_id INTEGER PRIMARY KEY,
  vault_sync INTEGER NOT NULL DEFAULT 0,
  phone_sync INTEGER NOT NULL DEFAULT 0
);
INSERT OR REPLACE INTO sources (id, source_name, source_type, status)
VALUES (1, 'GitHub', 'github', 'active');
INSERT OR REPLACE INTO sync_policies (source_id, vault_sync, phone_sync)
VALUES (1, 1, 0);