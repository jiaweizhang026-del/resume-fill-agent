CREATE TABLE IF NOT EXISTS product_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  credit_units INTEGER NOT NULL DEFAULT 0 CHECK (credit_units >= 0),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS product_keys_status_expiry
  ON product_keys(status, expires_at);
