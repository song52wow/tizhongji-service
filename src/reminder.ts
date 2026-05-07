import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import type { Reminder, CreateReminderInput, ErrorResponse } from './types';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VALID_PERIODS = ['morning', 'evening', 'both'];

function toReminder(row: Record<string, unknown>): Reminder {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    remindTime: row['remind_time'] as string,
    period: row['period'] as 'morning' | 'evening' | 'both',
    enabled: (row['enabled'] as number) === 1,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

export function createReminder(input: CreateReminderInput): Reminder | ErrorResponse {
  if (!input.userId) {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }
  if (!input.remindTime || !TIME_REGEX.test(input.remindTime)) {
    return { success: false, error: 'remindTime 格式不正确，应为 HH:MM', statusCode: 400 };
  }
  if (!input.period || !VALID_PERIODS.includes(input.period)) {
    return { success: false, error: 'period 必须是 morning、evening 或 both', statusCode: 400 };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = uuidv4();
  const enabled = input.enabled !== false ? 1 : 0;

  const stmt = db.prepare(`
    INSERT INTO reminders (id, user_id, remind_time, period, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, input.userId.trim(), input.remindTime.trim(), input.period.trim(), enabled, now, now);

  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as Record<string, unknown>;
  return toReminder(row);
}

export function listReminders(userId: string): Reminder[] | ErrorResponse {
  if (!userId) {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }

  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_time ASC'
  ).all(userId.trim()) as Record<string, unknown>[];

  return rows.map(toReminder);
}

export function updateReminder(
  id: string,
  userId: string,
  updates: { remindTime?: string; period?: string; enabled?: boolean }
): Reminder | ErrorResponse {
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM reminders WHERE id = ? AND user_id = ?'
  ).get(id, userId.trim()) as Record<string, unknown> | undefined;

  if (!existing) {
    return { success: false, error: '提醒不存在或无权操作', statusCode: 404 };
  }

  if (updates.remindTime && !TIME_REGEX.test(updates.remindTime)) {
    return { success: false, error: 'remindTime 格式不正确，应为 HH:MM', statusCode: 400 };
  }
  if (updates.period && !VALID_PERIODS.includes(updates.period)) {
    return { success: false, error: 'period 必须是 morning、evening 或 both', statusCode: 400 };
  }

  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const params: (string | number)[] = [now];

  if (updates.remindTime !== undefined) {
    fields.push('remind_time = ?');
    params.push(updates.remindTime.trim());
  }
  if (updates.period !== undefined) {
    fields.push('period = ?');
    params.push(updates.period.trim());
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?');
    params.push(updates.enabled ? 1 : 0);
  }

  params.push(id, userId.trim());
  db.prepare(
    `UPDATE reminders SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...params);

  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as Record<string, unknown>;
  return toReminder(row);
}

export function deleteReminder(id: string, userId: string): boolean | ErrorResponse {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM reminders WHERE id = ? AND user_id = ?'
  ).run(id, userId.trim());

  if (result.changes === 0) {
    return { success: false, error: '提醒不存在或无权操作', statusCode: 404 };
  }
  return true;
}
