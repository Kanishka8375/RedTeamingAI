export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL,
  monthly_event_limit INTEGER NOT NULL,
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  agent_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  latency_ms INTEGER NOT NULL,
  tool_calls_requested TEXT NOT NULL,
  tool_calls_in_response TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_preview TEXT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  anomaly_flags TEXT NOT NULL,
  raw_request TEXT NOT NULL,
  raw_response TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  condition TEXT NOT NULL,
  action TEXT NOT NULL,
  severity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS attack_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_agents (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS alert_settings (
  customer_id TEXT PRIMARY KEY,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  slack_enabled INTEGER NOT NULL DEFAULT 0,
  daily_digest_enabled INTEGER NOT NULL DEFAULT 0,
  email_to TEXT,
  slack_webhook_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  digest_hour INTEGER NOT NULL DEFAULT 8,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS billing_history (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  stripe_invoice_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS alerts_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  event_id TEXT,
  channel TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Auth lookup
CREATE INDEX IF NOT EXISTS idx_customers_plan ON customers(plan);

-- Dashboard feed
CREATE INDEX IF NOT EXISTS idx_events_customer_time ON events(customer_id, timestamp DESC);
-- Top risky queries
CREATE INDEX IF NOT EXISTS idx_events_customer_risk ON events(customer_id, risk_score DESC);
-- Blocked event drilldown
CREATE INDEX IF NOT EXISTS idx_events_customer_blocked_time ON events(customer_id, blocked, timestamp DESC);
-- Agent timeline
CREATE INDEX IF NOT EXISTS idx_events_customer_agent_time ON events(customer_id, agent_id, timestamp DESC);
-- Cost by model
CREATE INDEX IF NOT EXISTS idx_events_customer_model ON events(customer_id, model);

-- Policy loading path
CREATE INDEX IF NOT EXISTS idx_policies_customer_enabled ON policies(customer_id, enabled);

-- Fast block checks
CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_agents_customer_agent ON blocked_agents(customer_id, agent_id);

-- Alert settings fetch
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_settings_customer ON alert_settings(customer_id);

-- Billing history
CREATE INDEX IF NOT EXISTS idx_billing_history_customer_created ON billing_history(customer_id, created_at DESC);

-- Alerts audit
CREATE INDEX IF NOT EXISTS idx_alerts_log_customer_created ON alerts_log(customer_id, created_at DESC);
`;
