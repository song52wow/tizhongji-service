import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

function loadEnv(): void {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  }
}

loadEnv();

const DB_PATH = process.env.DB_PATH
  ? path.isAbsolute(process.env.DB_PATH)
    ? process.env.DB_PATH
    : path.join(__dirname, '..', process.env.DB_PATH)
  : path.join(__dirname, '..', 'notifications.db');

let db: Database.Database | null = null;

export function getDb(inMemory = false): Database.Database {
  if (!db) {
    const dbPath = inMemory ? ':memory:' : DB_PATH;
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

export function resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function initSchema(database: Database.Database): void {
  database.exec(`
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
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}