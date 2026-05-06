import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import type {
  DailyWeightRecord,
  WeightRecordWithDiff,
  CreateWeightRecordInput,
  WeightRecordQuery,
  V2WeightStats,
  WeightPeriod,
  PaginatedResult,
  ErrorResponse,
} from './types';

const MIN_WEIGHT = 20.0;
const MAX_WEIGHT = 300.0;
const MAX_NOTE_LENGTH = 200;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PERIODS: WeightPeriod[] = ['morning', 'evening'];

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

function toDailyWeightRecord(row: Record<string, unknown>): DailyWeightRecord {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    date: row['date'] as string,
    period: row['period'] as WeightPeriod,
    weight: row['weight'] as number,
    note: (row['note'] as string | null) ?? undefined,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function validateInput(input: CreateWeightRecordInput): ErrorResponse | null {
  if (!input.period || !VALID_PERIODS.includes(input.period)) {
    return { success: false, error: 'period 必须是 morning 或 evening', statusCode: 400 };
  }
  if (typeof input.weight !== 'number' || !Number.isFinite(input.weight)) {
    return { success: false, error: '体重值无效', statusCode: 400 };
  }
  if (input.weight < MIN_WEIGHT || input.weight > MAX_WEIGHT) {
    return { success: false, error: `体重需在 ${MIN_WEIGHT}~${MAX_WEIGHT} kg 范围内`, statusCode: 400 };
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
  if (input.note) {
    // Check for HTML/script injection patterns
    const note = input.note;
    const hasScript = /<script[\s\S]*?<\/script>/gi.test(note);
    const hasEventHandler = /\bon\w+\s*=/gi.test(note);
    const hasJavascript = /javascript:/gi.test(note);
    const hasHtmlTags = /<\/?[a-z][^>]*>/gi.test(note);
    if (hasScript || hasEventHandler || hasJavascript || hasHtmlTags) {
      return { success: false, error: '备注包含非法内容', statusCode: 400 };
    }
  }
  return null;
}

export function upsertWeightRecord(input: CreateWeightRecordInput): DailyWeightRecord | ErrorResponse {
  const validationError = validateInput(input);
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

  const existing = db.prepare(
    'SELECT * FROM weight_records WHERE user_id = ? AND date = ? AND period = ?'
  ).get(input.userId.trim(), input.date, input.period) as Record<string, unknown> | undefined;

  if (existing) {
    const updateStmt = db.prepare(`
      UPDATE weight_records SET weight = ?, note = ?, updated_at = ? WHERE id = ?
    `);
    updateStmt.run(input.weight, input.note?.trim() ?? null, now, existing['id']);
    const updated = db.prepare('SELECT * FROM weight_records WHERE id = ?').get(existing['id']) as Record<string, unknown>;
    return toDailyWeightRecord(updated);
  } else {
    const id = uuidv4();
    const insertStmt = db.prepare(`
      INSERT INTO weight_records (id, user_id, date, period, weight, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(
      id,
      input.userId.trim(),
      input.date,
      input.period,
      input.weight,
      input.note?.trim() ?? null,
      now,
      now
    );
    const row = db.prepare('SELECT * FROM weight_records WHERE id = ?').get(id) as Record<string, unknown>;
    return toDailyWeightRecord(row);
  }
}

export function listWeightRecords(query: WeightRecordQuery): PaginatedResult<WeightRecordWithDiff> | ErrorResponse {
  if (!query.userId || typeof query.userId !== 'string' || query.userId.trim() === '') {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }
  if (query.period !== undefined && !VALID_PERIODS.includes(query.period)) {
    return { success: false, error: 'period 必须是 morning 或 evening', statusCode: 400 };
  }
  const rangeErr = validateDateRange(query.startDate, query.endDate);
  if (rangeErr) return rangeErr;

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const db = getDb();
  const conditions: string[] = ['user_id = ?'];
  const params: (string | number)[] = [query.userId.trim()];

  if (query.startDate) {
    conditions.push('date >= ?');
    params.push(query.startDate);
  }
  if (query.endDate) {
    conditions.push('date <= ?');
    params.push(query.endDate);
  }
  if (query.period) {
    conditions.push('period = ?');
    params.push(query.period);
  }

  const whereClause = conditions.join(' AND ');
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM weight_records WHERE ${whereClause}`);
  const total = (countStmt.get(...params) as { count: number }).count;

  const selectStmt = db.prepare(
    `SELECT * FROM weight_records WHERE ${whereClause} ORDER BY date ASC, period ASC LIMIT ? OFFSET ?`
  );
  const rows = selectStmt.all(...params, pageSize, offset) as Record<string, unknown>[];
  const items = rows.map(toDailyWeightRecord);

  // 计算 weightDiff：如果同一天同时存在 morning 和 evening 记录，则计算差值
  const itemsWithDiff = computeWeightDiff(items);

  return { items: itemsWithDiff, total, page, pageSize };
}

function computeWeightDiff(records: DailyWeightRecord[]): WeightRecordWithDiff[] {
  // 按日期聚合
  const byDate = new Map<string, DailyWeightRecord[]>();
  for (const record of records) {
    const list = byDate.get(record.date) || [];
    list.push(record);
    byDate.set(record.date, list);
  }

  const result: WeightRecordWithDiff[] = [];
  for (const record of records) {
    const dayRecords = byDate.get(record.date) || [];
    let weightDiff: number | null = null;
    if (dayRecords.length === 2) {
      const morning = dayRecords.find(r => r.period === 'morning');
      const evening = dayRecords.find(r => r.period === 'evening');
      if (morning && evening) {
        weightDiff = Math.round((evening.weight - morning.weight) * 10) / 10;
      }
    }
    result.push({ ...record, weightDiff });
  }
  return result;
}

export function getWeightRecordById(id: string, userId: string): DailyWeightRecord | ErrorResponse {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM weight_records WHERE id = ? AND user_id = ?'
  ).get(id, userId.trim()) as Record<string, unknown> | undefined;
  if (!row) {
    return { success: false, error: '体重记录不存在或无权访问', statusCode: 404 };
  }
  return toDailyWeightRecord(row);
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

export function calculateWeightStats(query: WeightRecordQuery): V2WeightStats | ErrorResponse {
  const records = listAllWeightRecordsForStats(query);
  if ('success' in records && records.success === false) return records;

  const items = records as DailyWeightRecord[];

  if (items.length === 0) {
    return { avgMorningWeight: null, avgEveningWeight: null, minWeight: null, maxWeight: null, change: null, avgWeightDiff: null };
  }

  const morningWeights = items.filter(r => r.period === 'morning').map(r => r.weight);
  const eveningWeights = items.filter(r => r.period === 'evening').map(r => r.weight);

  const avgMorning = morningWeights.length > 0
    ? morningWeights.reduce((a, b) => a + b, 0) / morningWeights.length
    : 0;
  const avgEvening = eveningWeights.length > 0
    ? eveningWeights.reduce((a, b) => a + b, 0) / eveningWeights.length
    : 0;

  const allWeights = [...morningWeights, ...eveningWeights];
  const min = allWeights.length > 0 ? Math.min(...allWeights) : 0;
  const max = allWeights.length > 0 ? Math.max(...allWeights) : 0;

  // 计算 avgWeightDiff：同一天同时有 morning 和 evening 时计算
  const weightDiffs: number[] = [];
  const byDate = new Map<string, DailyWeightRecord[]>();
  for (const record of items) {
    const list = byDate.get(record.date) || [];
    list.push(record);
    byDate.set(record.date, list);
  }
  for (const [, dayRecords] of byDate) {
    if (dayRecords.length === 2) {
      const morning = dayRecords.find(r => r.period === 'morning');
      const evening = dayRecords.find(r => r.period === 'evening');
      if (morning && evening) {
        weightDiffs.push(Math.round((evening.weight - morning.weight) * 10) / 10);
      }
    }
  }
  const avgDiff = weightDiffs.length > 0
    ? weightDiffs.reduce((a, b) => a + b, 0) / weightDiffs.length
    : 0;

  let change: number | null = null;
  const sorted = [...items].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return a.period === 'evening' ? 1 : -1;
  });
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first.weight !== undefined && last.weight !== undefined) {
      change = Math.round((last.weight - first.weight) * 10) / 10;
    }
  }

  return {
    avgMorningWeight: morningWeights.length > 0 ? Math.round(avgMorning * 10) / 10 : null,
    avgEveningWeight: eveningWeights.length > 0 ? Math.round(avgEvening * 10) / 10 : null,
    minWeight: allWeights.length > 0 ? Math.round(min * 10) / 10 : null,
    maxWeight: allWeights.length > 0 ? Math.round(max * 10) / 10 : null,
    change,
    avgWeightDiff: weightDiffs.length > 0 ? Math.round(avgDiff * 10) / 10 : null,
  };
}

function listAllWeightRecordsForStats(query: WeightRecordQuery): DailyWeightRecord[] | ErrorResponse {
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
    `SELECT * FROM weight_records WHERE ${conditions.join(' AND ')} ORDER BY date ASC, period ASC`
  ).all(...params) as Record<string, unknown>[];

  return rows.map(toDailyWeightRecord);
}
