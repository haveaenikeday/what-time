CREATE TABLE IF NOT EXISTS schedules (
  id            TEXT PRIMARY KEY,
  phone_number  TEXT NOT NULL,
  contact_name  TEXT NOT NULL DEFAULT '',
  message       TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('one_time', 'daily', 'weekly')),
  scheduled_at  TEXT,
  time_of_day   TEXT,
  day_of_week   INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1,
  dry_run       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS run_logs (
  id            TEXT PRIMARY KEY,
  schedule_id   TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK(status IN ('success', 'failed', 'dry_run', 'skipped')),
  error_message TEXT,
  fired_at      TEXT NOT NULL,
  completed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_logs_schedule ON run_logs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_run_logs_fired_at ON run_logs(fired_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('global_dry_run', '0'),
  ('default_country_code', '+1'),
  ('send_delay_ms', '3000'),
  ('whatsapp_app', 'WhatsApp');
