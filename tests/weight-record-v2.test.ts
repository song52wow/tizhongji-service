/**
 * 体重记录 v2 单元测试
 * 覆盖：morning/evening 独立记录 CRUD、weightDiff 计算逻辑、
 * 统计接口 avgWeightDiff、日期聚合查询、边界条件
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import http from 'http';
import { Router } from '../src/router';
import {
  upsertWeightRecord,
  listWeightRecords,
  getWeightRecordById,
  deleteWeightRecord,
  calculateWeightStats,
} from '../src/weight-record';
import { resetDb } from '../src/db';

const AUTH_SECRET = 'test-secret';

function makeSignature(userId: string): string {
  return crypto.createHmac('sha256', AUTH_SECRET).update(userId).digest('hex');
}

function makeAuthHeaders(userId: string): Record<string, string> {
  return {
    'x-user-id': userId,
    'x-user-signature': makeSignature(userId),
  };
}

function createTestRouter(): Router {
  return new Router();
}

function setupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE weight_records (
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
    CREATE INDEX idx_weight_records_user_date ON weight_records(user_id, date);
    CREATE INDEX idx_weight_records_user_period ON weight_records(user_id, period);
  `);
  return db;
}

function injectDb(db: Database.Database) {
  const dbModule = require('../src/db') as typeof import('../src/db');
  dbModule.getDb = () => db;
}

// ============ computeWeightDiff 单元测试 ============

describe('V2-001: computeWeightDiff — weightDiff 计算单元', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('同一日期有 morning 和 evening 时，weightDiff = evening - morning，保留一位小数', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.3 });

    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-20' }) as { items: { period: string; weightDiff: number | null }[] };
    const morning = result.items.find(i => i.period === 'morning')!;
    const evening = result.items.find(i => i.period === 'evening')!;

    expect(morning.weightDiff).toBe(-0.7);
    expect(evening.weightDiff).toBe(-0.7);
  });

  test('仅 morning 记录时 weightDiff 为 null', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });

    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-20' }) as { items: { weightDiff: number | null }[] };
    expect(result.items[0].weightDiff).toBeNull();
  });

  test('仅 evening 记录时 weightDiff 为 null', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.5 });

    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-20' }) as { items: { weightDiff: number | null }[] };
    expect(result.items[0].weightDiff).toBeNull();
  });

  test('多天中部分天有完整 morning+evening，weightDiff 只在完整日计算', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'morning', weight: 64.8 });
    // 04-21 没有 evening
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-22', period: 'morning', weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-22', period: 'evening', weight: 64.0 });

    const result = listWeightRecords({ userId: 'user-001' }) as { items: { date: string; period: string; weightDiff: number | null }[] };
    const day20m = result.items.find(i => i.date === '2026-04-20' && i.period === 'morning')!;
    const day21m = result.items.find(i => i.date === '2026-04-21' && i.period === 'morning')!;
    const day22m = result.items.find(i => i.date === '2026-04-22' && i.period === 'morning')!;

    expect(day20m.weightDiff).toBe(-0.5);
    expect(day21m.weightDiff).toBeNull();
    expect(day22m.weightDiff).toBe(-0.5);
  });

  test('weightDiff 为正数时正确计算（晚上比早上重）', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 65.8 });

    const result = listWeightRecords({ userId: 'user-001' }) as { items: { period: string; weightDiff: number | null }[] };
    expect(result.items[0].weightDiff).toBe(0.8);
  });

  test('weightDiff 为 0 时正确计算', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 65.0 });

    const result = listWeightRecords({ userId: 'user-001' }) as { items: { period: string; weightDiff: number | null }[] };
    expect(result.items[0].weightDiff).toBe(0.0);
  });
});

// ============ avgWeightDiff 统计测试 ============

describe('V2-002: avgWeightDiff 统计计算', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('两天都有完整记录时，avgWeightDiff 是两天的平均值', () => {
    // day1: evening - morning = -0.5
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.5 });
    // day2: evening - morning = -0.3
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'morning', weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'evening', weight: 64.2 });

    const result = calculateWeightStats({ userId: 'user-001' }) as { avgWeightDiff: number };
    expect(result.avgWeightDiff).toBe(-0.4); // (-0.5 + -0.3) / 2
  });

  test('仅有一天有完整记录时，avgWeightDiff 等于该天差值', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.0 });

    const result = calculateWeightStats({ userId: 'user-001' }) as { avgWeightDiff: number };
    expect(result.avgWeightDiff).toBe(-1.0);
  });

  test('没有任何完整日期时 avgWeightDiff 为 null', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'morning', weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-22', period: 'evening', weight: 64.0 });

    const result = calculateWeightStats({ userId: 'user-001' }) as { avgWeightDiff: number | null };
    expect(result.avgWeightDiff).toBeNull();
  });

  test('avgWeightDiff 保留一位小数', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.37 });

    const result = calculateWeightStats({ userId: 'user-001' }) as { avgWeightDiff: number };
    expect(result.avgWeightDiff).toBe(-0.6); // (64.37 - 65.0) = -0.63 → rounded to -0.6
  });

  test('日期范围过滤后只统计范围内的完整日', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-18', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-18', period: 'evening', weight: 64.0 }); // diff=-1.0
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 64.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 63.5 }); // diff=-0.5
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-22', period: 'morning', weight: 63.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-22', period: 'evening', weight: 62.0 }); // diff=-1.0

    const result = calculateWeightStats({ userId: 'user-001', startDate: '2026-04-19', endDate: '2026-04-21' }) as { avgWeightDiff: number };
    expect(result.avgWeightDiff).toBe(-0.5); // 只有 04-20 在范围内
  });
});

// ============ 日期聚合查询测试 ============

describe('V2-003: 日期聚合查询', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('按日期范围查询返回该范围内所有记录', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-18', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-19', period: 'morning', weight: 64.8 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'morning', weight: 64.3 });

    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-19', endDate: '2026-04-20' }) as { total: number; items: { date: string }[] };
    expect(result.total).toBe(2);
    expect(result.items.map(i => i.date).sort()).toEqual(['2026-04-19', '2026-04-20']);
  });

  test('仅指定 startDate 时返回从该日期到现在的所有记录', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-15', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-25', period: 'morning', weight: 64.0 });

    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20' }) as { total: number };
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  test('仅指定 endDate 时返回从开始到该日期的所有记录', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-10', period: 'morning', weight: 66.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-25', period: 'morning', weight: 64.5 });

    const result = listWeightRecords({ userId: 'user-001', endDate: '2026-04-20' }) as { total: number };
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  test('列表按 date ASC, period ASC 排序', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'morning', weight: 64.8 });

    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-21' }) as { items: { date: string; period: string; weightDiff: number | null }[] };
    // ORDER BY date ASC, period ASC → period 按字母排序，'evening' < 'morning'
    // 所以顺序是：04-20 evening, 04-20 morning, 04-21 morning
    expect(result.items[0].date).toBe('2026-04-20');
    expect(result.items[0].period).toBe('evening');
    expect(result.items[0].weightDiff).toBe(-0.5);
    expect(result.items[1].date).toBe('2026-04-20');
    expect(result.items[1].period).toBe('morning');
    expect(result.items[1].weightDiff).toBe(-0.5);
    expect(result.items[2].date).toBe('2026-04-21');
    expect(result.items[2].period).toBe('morning');
    expect(result.items[2].weightDiff).toBeNull();
  });
});

// ============ CRUD 独立记录测试 ============

describe('V2-004: morning/evening 独立记录 CRUD', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('同一用户同一天可以各创建一条 morning 和 evening 记录', () => {
    const morning = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    const evening = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.5 });

    expect((morning as { id: string }).id).toBeDefined();
    expect((evening as { id: string }).id).toBeDefined();
    expect((morning as { id: string }).id).not.toBe((evening as { id: string }).id);
  });

  test('同一天相同 period 的记录被 upsert 时覆盖', () => {
    const first = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0, note: '第一次' }) as { id: string };
    const second = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 64.5, note: '更新' }) as { id: string };

    expect(second.id).toBe(first.id); // ID 不变
    expect((second as unknown as { weight: number }).weight).toBe(64.5);
  });

  test('删除 morning 记录不影响同一天的 evening 记录', () => {
    const morning = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 }) as { id: string };
    const evening = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.5 }) as { id: string };

    deleteWeightRecord(morning.id, 'user-001');

    const list = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-20' }) as unknown as { items: { period: string }[]; total: number };
    expect(list.total).toBe(1);
    expect(list.items[0].period).toBe('evening');
  });

  test('通过 getWeightRecordById 可以独立获取 morning 或 evening 记录', () => {
    const morning = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 }) as { id: string };
    const evening = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.5 }) as { id: string };

    const getMorning = getWeightRecordById(morning.id, 'user-001') as { period: string; weight: number };
    const getEvening = getWeightRecordById(evening.id, 'user-001') as { period: string; weight: number };

    expect(getMorning.period).toBe('morning');
    expect(getMorning.weight).toBe(65.0);
    expect(getEvening.period).toBe('evening');
    expect(getEvening.weight).toBe(64.5);
  });
});

// ============ 边界条件测试 ============

describe('V2-005: 边界条件', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('体重精度：小数点后超过一位', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.123456 }) as { weight: number };
    expect(result.weight).toBe(65.123456);
  });

  test('体重精度：极小值 0.1kg', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 65.1 });
    const result = listWeightRecords({ userId: 'user-001' }) as { items: { weightDiff: number | null }[] };
    expect(result.items[0].weightDiff).toBe(0.1);
  });

  test('空数据时 calculateWeightStats 所有字段为 null', () => {
    const result = calculateWeightStats({ userId: 'user-no-data' }) as unknown as Record<string, unknown>;
    expect(result.avgMorningWeight).toBeNull();
    expect(result.avgEveningWeight).toBeNull();
    expect(result.minWeight).toBeNull();
    expect(result.maxWeight).toBeNull();
    expect(result.change).toBeNull();
    expect(result.avgWeightDiff).toBeNull();
  });

  test('仅一条记录时 change 为 null', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    const result = calculateWeightStats({ userId: 'user-001' }) as { change: number | null };
    expect(result.change).toBeNull();
  });

  test('仅一条记录时 avgMorningWeight 和 avgEveningWeight 不为 null（取决于 period）', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    const result = calculateWeightStats({ userId: 'user-001' }) as { avgMorningWeight: number | null; avgEveningWeight: number | null };
    expect(result.avgMorningWeight).toBe(65.0);
    expect(result.avgEveningWeight).toBeNull();
  });

  test('备注字段被正确 trim', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0, note: '  前后有空格  ' }) as { note: string };
    expect(result.note).toBe('前后有空格');
  });

  test('日期校验：2026-04-31（不存在）被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-31', period: 'morning', weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('日期校验：2026-13-01（月份无效）被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-13-01', period: 'morning', weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('日期校验：2026-00-15（月份为0）被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-00-15', period: 'morning', weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('日期校验：未来日期被拒绝', () => {
    const futureDate = '2099-12-31';
    const result = upsertWeightRecord({ userId: 'user-001', date: futureDate, period: 'morning', weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect((result as unknown as { error: string }).error).toContain('当前日期');
  });

  test('日期校验：今天可以通过', () => {
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const result = upsertWeightRecord({ userId: 'user-001', date: today, period: 'morning', weight: 65.0 }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('NaN 体重被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: NaN } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('Infinity 体重被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: Infinity } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('-Infinity 体重被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: -Infinity } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('undefined weight 被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: undefined } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

// ============ V2Stats 完整性测试 ============

describe('V2-006: V2WeightStats 完整性', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('V2WeightStats 所有字段都存在且类型正确', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 64.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'morning', weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'evening', weight: 63.5 });

    const result = calculateWeightStats({ userId: 'user-001' }) as unknown as Record<string, unknown>;

    expect(result).toHaveProperty('avgMorningWeight');
    expect(result).toHaveProperty('avgEveningWeight');
    expect(result).toHaveProperty('minWeight');
    expect(result).toHaveProperty('maxWeight');
    expect(result).toHaveProperty('change');
    expect(result).toHaveProperty('avgWeightDiff');

    expect(result.avgMorningWeight).toBe(64.8); // (65.0 + 64.5) / 2
    expect(result.avgEveningWeight).toBe(63.8); // (64.0 + 63.5) / 2
    expect(result.minWeight).toBe(63.5);
    expect(result.maxWeight).toBe(65.0);
    expect(result.avgWeightDiff).toBe(-1.0); // (-1.0 + -1.0) / 2
    // change: first record 2026-04-20 morning 65.0 -> last record 2026-04-21 evening 63.5 = -1.5
    expect(result.change).toBe(-1.5);
  });

  test('avgMorningWeight 包含所有 morning 记录', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-18', period: 'morning', weight: 66.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning', weight: 64.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-22', period: 'morning', weight: 62.0 });

    const result = calculateWeightStats({ userId: 'user-001' }) as { avgMorningWeight: number | null };
    expect(result.avgMorningWeight).toBe(64.0); // (66+64+62)/3
  });

  test('avgEveningWeight 包含所有 evening 记录', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-18', period: 'evening', weight: 65.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening', weight: 63.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-22', period: 'evening', weight: 61.5 });

    const result = calculateWeightStats({ userId: 'user-001' }) as { avgEveningWeight: number | null };
    expect(result.avgEveningWeight).toBe(63.5); // (65.5+63.5+61.5)/3
  });

  test('change 使用第一条到最后一条记录的差值（按日期+period 排序）', () => {
    // 按排序：第一条 04-18 morning，最后一条 04-19 evening
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-18', period: 'morning', weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-18', period: 'evening', weight: 64.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-19', period: 'morning', weight: 63.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-19', period: 'evening', weight: 62.5 });

    const result = calculateWeightStats({ userId: 'user-001' }) as { change: number };
    expect(result.change).toBe(-2.5); // 62.5 - 65.0
  });
});
