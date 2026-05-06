-- UP BEGIN
-- Initial schema (v1)
-- This migration creates the base schema if it doesn't exist.
-- Applied automatically by initSchema() in db.ts

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('system', 'order', 'message', 'campaign')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type ON notifications(user_id, type);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, deleted);

CREATE TABLE IF NOT EXISTS weight_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  period TEXT NOT NULL CHECK(period IN ('morning', 'evening')),
  weight REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, date, period)
);

CREATE INDEX IF NOT EXISTS idx_weight_records_user_date ON weight_records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_weight_records_user_period ON weight_records(user_id, period);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
-- UP END

-- DOWN BEGIN
-- Rollback: drop all application tables
DROP INDEX IF EXISTS idx_notifications_user_id;
DROP INDEX IF EXISTS idx_notifications_user_type;
DROP INDEX IF EXISTS idx_notifications_user_unread;
DROP TABLE IF EXISTS notifications;

DROP INDEX IF EXISTS idx_weight_records_user_date;
DROP INDEX IF EXISTS idx_weight_records_user_period;
DROP TABLE IF EXISTS weight_records;

DROP TABLE IF EXISTS schema_migrations;
-- DOWN END
