CREATE TABLE IF NOT EXISTS control_operations (
  operation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  source_name TEXT,
  target_type TEXT,
  target_id TEXT,
  authorization_state TEXT NOT NULL,
  policy_decision TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  failure_category TEXT,
  recovery_state TEXT,
  result_json TEXT,
  audit_ref TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  authorized_at TEXT,
  started_at TEXT,
  verified_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_control_operations_state
  ON control_operations(state, updated_at);

CREATE INDEX IF NOT EXISTS idx_control_operations_source
  ON control_operations(source_name, updated_at);

CREATE TABLE IF NOT EXISTS control_operation_events (
  event_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  state TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(operation_id) REFERENCES control_operations(operation_id)
);

CREATE INDEX IF NOT EXISTS idx_control_operation_events_operation
  ON control_operation_events(operation_id, created_at);
