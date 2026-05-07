import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import type { UserActivity, ActivityType, AchievementStats, ErrorResponse } from './types';

const VALID_ACTIVITY_TYPES: ActivityType[] = ['login', 'record_weight', 'check_in'];

function toUserActivity(row: Record<string, unknown>): UserActivity {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    activityType: row['activity_type'] as ActivityType,
    date: row['date'] as string,
    metadata: (row['metadata'] as string | undefined) ?? undefined,
    createdAt: row['created_at'] as string,
  };
}

export function recordActivity(
  userId: string,
  activityType: ActivityType,
  date: string,
  metadata?: string
): UserActivity | ErrorResponse {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }
  if (!activityType || !VALID_ACTIVITY_TYPES.includes(activityType)) {
    return { success: false, error: 'activityType 必须是 login、record_weight 或 check_in', statusCode: 400 };
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { success: false, error: 'date 格式不正确，应为 YYYY-MM-DD', statusCode: 400 };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = uuidv4();

  // Check for duplicate (same user, same type, same date)
  const existing = db.prepare(
    'SELECT id FROM user_activities WHERE user_id = ? AND activity_type = ? AND date = ?'
  ).get(userId.trim(), activityType, date) as Record<string, unknown> | undefined;

  if (existing) {
    // Already recorded for today, return the existing one
    const row = db.prepare('SELECT * FROM user_activities WHERE id = ?').get(existing['id']) as Record<string, unknown>;
    return toUserActivity(row);
  }

  const stmt = db.prepare(`
    INSERT INTO user_activities (id, user_id, activity_type, date, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, userId.trim(), activityType, date, metadata ?? null, now);

  const row = db.prepare('SELECT * FROM user_activities WHERE id = ?').get(id) as Record<string, unknown>;
  return toUserActivity(row);
}

export function getAchievementStats(userId: string): AchievementStats | ErrorResponse {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }

  const db = getDb();
  userId = userId.trim();

  // Total login days
  const loginRow = db.prepare(
    `SELECT COUNT(DISTINCT date) as count FROM user_activities WHERE user_id = ? AND activity_type = 'login'`
  ).get(userId) as { count: number };
  const totalLoginDays = loginRow.count;

  // Total weight records (distinct dates where weight was recorded)
  const recordRows = db.prepare(
    `SELECT COUNT(*) as count FROM weight_records WHERE user_id = ?`
  ).get(userId) as { count: number };
  const totalRecords = recordRows.count;

  // Distinct dates with weight records
  const recordDateRows = db.prepare(
    `SELECT COUNT(DISTINCT date) as count FROM weight_records WHERE user_id = ?`
  ).get(userId) as { count: number };
  const consecutiveRecordDays = recordDateRows.count;

  // Calculate streaks based on weight records
  const dateRows = db.prepare(
    `SELECT DISTINCT date FROM weight_records WHERE user_id = ? ORDER BY date DESC`
  ).all(userId) as { date: string }[];

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  if (dateRows.length > 0) {
    // Calculate consecutive days
    const today = new Date();
    const todayStr = toDateString(today);
    const yesterdayStr = toDateString(new Date(today.getTime() - 86400000));

    // Check if the most recent record is today or yesterday (for current streak)
    const mostRecentDate = dateRows[0].date;
    if (mostRecentDate === todayStr || mostRecentDate === yesterdayStr) {
      currentStreak = 1;
      for (let i = 1; i < dateRows.length; i++) {
        const prevDate = new Date(dateRows[i - 1].date);
        const currDate = new Date(dateRows[i].date);
        const diffDays = Math.round((prevDate.getTime() - currDate.getTime()) / 86400000);
        if (diffDays === 1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    // Calculate longest streak
    tempStreak = 1;
    longestStreak = 1;
    for (let i = 1; i < dateRows.length; i++) {
      const prevDate = new Date(dateRows[i - 1].date);
      const currDate = new Date(dateRows[i].date);
      const diffDays = Math.round((prevDate.getTime() - currDate.getTime()) / 86400000);
      if (diffDays === 1) {
        tempStreak++;
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
        }
      } else {
        tempStreak = 1;
      }
    }
  }

  return {
    totalLoginDays,
    consecutiveRecordDays,
    currentStreak,
    longestStreak,
    totalRecords,
  };
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
