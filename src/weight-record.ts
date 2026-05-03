import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import type {
  WeightRecord,
  CreateWeightRecordInput,
  WeightRecordQuery,
  PaginatedResult,
  ErrorResponse,
} from './types';

const MIN_WEIGHT = 20.0;
const MAX_WEIGHT = 300.0;
const MAX_NOTE_LENGTH = 200;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function getLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getToday(): string {
  return getLocalDateString(new Date());
}

function isValidDateFormat(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}

function validateDateRange(startDate?: string, endDate?: string): ErrorResponse | null {
  if (startDate && !isValidDateFormat(startDate)) {
    return { success: false, error: 'startDate 格式不正确，应为 YYYY-MM-DD', statusCode: 400 };
  }
  if (endDate && !isValidDateFormat(endDate)) {
    return { success: false, error: 'endDate 格式不正确，应为 YYYY-MM-DD', statusCode: 400 };
  }
  if (startDate && endDate && startDate > endDate) {
    return { success: false, error: 'startDate 不能晚于 endDate', statusCode: 400 };
  }
  return null;
}

function toWeightRecord(row: Record<string, unknown>): WeightRecord {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    date: row['date'] as string,
    morningWeight: (row['morning_weight'] as number | null) ?? undefined,
    eveningWeight: (row['evening_weight'] as number | null) ?? undefined,
    note: (row['note'] as string | null) ?? undefined,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function validateWeightInput(input: CreateWeightRecordInput): ErrorResponse | null {
  if (input.morningWeight !== undefined && input.morningWeight !== null) {
    if (!Number.isFinite(input.morningWeight) || input.morningWeight < MIN_WEIGHT || input.morningWeight > MAX_WEIGHT) {
      return { success: false, error: '早体重需在 20.0~300.0 kg 范围内', statusCode: 400 };
    }
  }
  if (input.eveningWeight !== undefined && input.eveningWeight !== null) {
    if (!Number.isFinite(input.eveningWeight) || input.eveningWeight < MIN_WEIGHT || input.eveningWeight > MAX_WEIGHT) {
      return { success: false, error: '晚体重需在 20.0~300.0 kg 范围内', statusCode: 400 };
    }
  }
  if (
    (input.morningWeight === undefined || input.morningWeight === null) &&
    (input.eveningWeight === undefined || input.eveningWeight === null)
  ) {
    return { success: false, error: '早体重和晚体重至少填写一项', statusCode: 400 };
  }
  const today = getToday();
  if (input.date > today) {
    return { success: false, error: '日期不能超过当前日期', statusCode: 400 };
  }
  if (!isValidDateFormat(input.date)) {
    return { success: false, error: '日期格式不正确，应为 YYYY-MM-DD', statusCode: 400 };
  }
  if (input.note && (typeof input.note !== 'string' || input.note.length > MAX_NOTE_LENGTH)) {
    return { success: false, error: `备注最多${MAX_NOTE_LENGTH}字符`, statusCode: 400 };
  }
  return null;
}

export function upsertWeightRecord(input: CreateWeightRecordInput): WeightRecord | ErrorResponse {
  const validationError = validateWeightInput(input);
  if (validationError) {
    return validationError;
  }

  if (!input.userId || typeof input.userId !== 'string' || input.userId.trim() === '') {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { success: false, error: '日期格式不正确，应为 YYYY-MM-DD', statusCode: 400 };
  }

  const db = getDb();
  const now = new Date().toISOString();

  // Check if record exists for this user+date
  const existing = db.prepare(
    'SELECT * FROM weight_records WHERE user_id = ? AND date = ?'
  ).get(input.userId.trim(), input.date) as Record<string, unknown> | undefined;

  if (existing) {
    // Update existing record
    const updateStmt = db.prepare(`
      UPDATE weight_records
      SET morning_weight = ?, evening_weight = ?, note = ?, updated_at = ?
      WHERE id = ?
    `);
    updateStmt.run(
      input.morningWeight ?? null,
      input.eveningWeight ?? null,
      input.note?.trim() ?? null,
      now,
      existing['id']
    );
    const updated = db.prepare('SELECT * FROM weight_records WHERE id = ?').get(existing['id']) as Record<string, unknown>;
    return toWeightRecord(updated);
  } else {
    // Insert new record
    const id = uuidv4();
    const insertStmt = db.prepare(`
      INSERT INTO weight_records (id, user_id, date, morning_weight, evening_weight, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(
      id,
      input.userId.trim(),
      input.date,
      input.morningWeight ?? null,
      input.eveningWeight ?? null,
      input.note?.trim() ?? null,
      now,
      now
    );
    const row = db.prepare('SELECT * FROM weight_records WHERE id = ?').get(id) as Record<string, unknown>;
    return toWeightRecord(row);
  }
}

export function listWeightRecords(query: WeightRecordQuery): PaginatedResult<WeightRecord> | ErrorResponse {
  if (!query.userId || typeof query.userId !== 'string' || query.userId.trim() === '') {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }
  const rangeErr = validateDateRange(query.startDate, query.endDate);
  if (rangeErr) return rangeErr;

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const db = getDb();
  const conditions: string[] = ['1=1'];
  const params: (string | number)[] = [];

  conditions.push('user_id = ?');
  params.push(query.userId.trim());

  if (query.startDate) {
    conditions.push('date >= ?');
    params.push(query.startDate);
  }
  if (query.endDate) {
    conditions.push('date <= ?');
    params.push(query.endDate);
  }

  const whereClause = conditions.join(' AND ');
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM weight_records WHERE ${whereClause}`);
  const total = (countStmt.get(...params) as { count: number }).count;

  const selectStmt = db.prepare(
    `SELECT * FROM weight_records WHERE ${whereClause} ORDER BY date ASC LIMIT ? OFFSET ?`
  );
  const rows = selectStmt.all(...params, pageSize, offset) as Record<string, unknown>[];
  const items = rows.map(toWeightRecord);

  return { items, total, page, pageSize };
}

export function getWeightRecordById(id: string, userId: string): WeightRecord | ErrorResponse {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM weight_records WHERE id = ? AND user_id = ?'
  ).get(id, userId.trim()) as Record<string, unknown> | undefined;
  if (!row) {
    return { success: false, error: '体重记录不存在或无权访问', statusCode: 404 };
  }
  return toWeightRecord(row);
}

export function deleteWeightRecord(id: string, userId: string): boolean | ErrorResponse {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM weight_records WHERE id = ? AND user_id = ?'
  ).run(id, userId.trim());
  if (result.changes === 0) {
    return { success: false, error: '体重记录不存在或无权访问', statusCode: 404 };
  }
  return true;
}

export function calculateWeightStats(query: WeightRecordQuery): { avgMorningWeight: number | null; avgEveningWeight: number | null; minWeight: number | null; maxWeight: number | null; change: number | null } | ErrorResponse {
  const records = listAllWeightRecordsForStats(query);
  if ('success' in records && records.success === false) return records;

  const items = records as WeightRecord[];

  if (items.length === 0) {
    return { avgMorningWeight: null, avgEveningWeight: null, minWeight: null, maxWeight: null, change: null };
  }

  const morningWeights = items.filter(r => r.morningWeight !== undefined).map(r => r.morningWeight as number);
  const eveningWeights = items.filter(r => r.eveningWeight !== undefined).map(r => r.eveningWeight as number);

  const avgMorning = morningWeights.length > 0
    ? morningWeights.reduce((a, b) => a + b, 0) / morningWeights.length
    : 0;
  const avgEvening = eveningWeights.length > 0
    ? eveningWeights.reduce((a, b) => a + b, 0) / eveningWeights.length
    : 0;

  const allWeights = [...morningWeights, ...eveningWeights];
  const min = allWeights.length > 0 ? Math.min(...allWeights) : 0;
  const max = allWeights.length > 0 ? Math.max(...allWeights) : 0;

  let change: number | null = null;
  if (items.length >= 2) {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstWeight = first.eveningWeight ?? first.morningWeight;
    const lastWeight = last.eveningWeight ?? last.morningWeight;
    if (firstWeight !== undefined && lastWeight !== undefined) {
      change = Math.round((lastWeight - firstWeight) * 10) / 10;
    }
  }

  return {
    avgMorningWeight: morningWeights.length > 0 ? Math.round(avgMorning * 10) / 10 : null,
    avgEveningWeight: eveningWeights.length > 0 ? Math.round(avgEvening * 10) / 10 : null,
    minWeight: allWeights.length > 0 ? Math.round(min * 10) / 10 : null,
    maxWeight: allWeights.length > 0 ? Math.round(max * 10) / 10 : null,
    change,
  };
}

function listAllWeightRecordsForStats(query: WeightRecordQuery): WeightRecord[] | ErrorResponse {
  if (!query.userId || typeof query.userId !== 'string' || query.userId.trim() === '') {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }
  const rangeErr = validateDateRange(query.startDate, query.endDate);
  if (rangeErr) return rangeErr;

  const db = getDb();
  const conditions = ['user_id = ?'];
  const params: (string | number)[] = [query.userId.trim()];

  if (query.startDate) {
    conditions.push('date >= ?');
    params.push(query.startDate);
  }
  if (query.endDate) {
    conditions.push('date <= ?');
    params.push(query.endDate);
  }

  const rows = db.prepare(
    `SELECT * FROM weight_records WHERE ${conditions.join(' AND ')} ORDER BY date ASC`
  ).all(...params) as Record<string, unknown>[];

  return rows.map(toWeightRecord);
}