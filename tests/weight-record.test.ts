import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import {
  upsertWeightRecord,
  listWeightRecords,
  getWeightRecordById,
  deleteWeightRecord,
  calculateWeightStats,
} from '../src/weight-record';
import { resetDb } from '../src/db';

function setupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE weight_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      morning_weight REAL,
      evening_weight REAL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, date)
    );
    CREATE INDEX idx_weight_records_user_date ON weight_records(user_id, date);
  `);
  return db;
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

describe('WT-001: 正常创建早体重记录', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('返回完整记录，包含 UUID', () => {
    const input = {
      userId: 'user-001',
      date: getToday(),
      morningWeight: 65.5,
    };
    const result = upsertWeightRecord(input) as { id: string; userId: string; date: string; morningWeight: number; eveningWeight: undefined };
    expect(result).toHaveProperty('id');
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result.userId).toBe('user-001');
    expect(result.morningWeight).toBe(65.5);
    expect(result.eveningWeight).toBeUndefined();
  });
});

describe('WT-002: 填写早体重和晚体重', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('保存成功，两项均返回', () => {
    const input = {
      userId: 'user-001',
      date: getToday(),
      morningWeight: 65.0,
      eveningWeight: 64.5,
      note: '锻炼后',
    };
    const result = upsertWeightRecord(input) as { morningWeight: number; eveningWeight: number; note: string };
    expect(result.morningWeight).toBe(65.0);
    expect(result.eveningWeight).toBe(64.5);
    expect(result.note).toBe('锻炼后');
  });
});

describe('WT-003: 早体重填写 15.0 kg', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('返回 400 错误', () => {
    const input = {
      userId: 'user-001',
      date: getToday(),
      morningWeight: 15.0,
    };
    const result = upsertWeightRecord(input) as { success: false; error: string; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toBe('早体重需在 20.0~300.0 kg 范围内');
  });
});

describe('WT-004: 早晚体重均不填', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('返回 400 错误', () => {
    const input = {
      userId: 'user-001',
      date: getToday(),
    };
    const result = upsertWeightRecord(input) as { success: false; error: string; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toBe('早体重和晚体重至少填写一项');
  });
});

describe('WT-005: 查询指定用户近7天记录', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('按日期升序返回记录列表', () => {
    const dates = ['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24'];
    for (const date of dates) {
      upsertWeightRecord({ userId: 'user-001', date, morningWeight: 65.0 + Math.random() * 0.5 });
    }

    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-26' }) as { items: { date: string }[]; total: number; page: number; pageSize: number };
    expect(result.total).toBe(5);
    expect(result.items.length).toBe(5);
    expect(result.items[0].date).toBe('2026-04-20');
    expect(result.items[4].date).toBe('2026-04-24');
  });
});

describe('WT-006: 获取不存在的记录ID', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('返回 404 错误', () => {
    const result = getWeightRecordById(uuidv4(), 'user-001') as { success: false; error: string; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.error).toBe('体重记录不存在或无权访问');
  });
});

describe('WT-007: 更新已存在的记录（同一日期）', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('记录被覆盖，updatedAt 更新', () => {
    const input1 = { userId: 'user-001', date: '2026-04-25', morningWeight: 65.0 };
    const created = upsertWeightRecord(input1) as { id: string; morningWeight: number; updatedAt: string };
    const originalUpdatedAt = created.updatedAt;

    // Wait a bit to ensure different timestamp
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }

    const input2 = { userId: 'user-001', date: '2026-04-25', morningWeight: 64.5, eveningWeight: 64.0 };
    const updated = upsertWeightRecord(input2) as { morningWeight: number; eveningWeight: number; updatedAt: string };

    expect(updated.morningWeight).toBe(64.5);
    expect(updated.eveningWeight).toBe(64.0);

    const list = listWeightRecords({ userId: 'user-001', startDate: '2026-04-25', endDate: '2026-04-25' }) as { items: { id: string }[] };
    expect(list.items.length).toBe(1);
  });
});

describe('WT-008: 删除体重记录后查询', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('记录不再出现', () => {
    const created = upsertWeightRecord({ userId: 'user-001', date: '2026-04-26', morningWeight: 65.0 }) as { id: string };
    expect(deleteWeightRecord(created.id, 'user-001')).toBe(true);

    const list = listWeightRecords({ userId: 'user-001' }) as { items: { id: string }[] };
    expect(list.items.find(r => r.id === created.id)).toBeUndefined();
  });

  test('删除不存在的记录返回 404', () => {
    const result = deleteWeightRecord(uuidv4(), 'user-001') as { success: false; error: string; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });
});

describe('WT-009: 跨用户越权 — 用户 B 无法读取用户 A 的记录', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('用户 B 调用 getWeightRecordById 返回 404', () => {
    const created = upsertWeightRecord({ userId: 'user-a', date: '2026-04-20', morningWeight: 65.0 }) as { id: string };
    const result = getWeightRecordById(created.id, 'user-b') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });
});

describe('WT-010: 跨用户越权 — 用户 B 无法删除用户 A 的记录', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('用户 B 调用 deleteWeightRecord 不删除用户 A 的记录', () => {
    const created = upsertWeightRecord({ userId: 'user-a', date: '2026-04-20', morningWeight: 65.0 }) as { id: string };
    const result = deleteWeightRecord(created.id, 'user-b') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    // 用户 A 的记录仍然存在
    const stillThere = getWeightRecordById(created.id, 'user-a');
    expect((stillThere as { id: string }).id).toBe(created.id);
  });
});

describe('WT-011: calculateWeightStats 字段名与文档一致', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('返回对象包含 avgMorningWeight、avgEveningWeight、minWeight、maxWeight、change', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', morningWeight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', morningWeight: 64.5, eveningWeight: 64.8 });
    const result = calculateWeightStats({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-22' }) as Record<string, unknown>;
    expect(result).toHaveProperty('avgMorningWeight');
    expect(result).toHaveProperty('avgEveningWeight');
    expect(result).toHaveProperty('minWeight');
    expect(result).toHaveProperty('maxWeight');
    expect(result).toHaveProperty('change');
    expect((result.avgMorningWeight as number | null)).toBe(64.8);
    expect((result.avgEveningWeight as number | null)).toBe(64.8);
  });
});

describe('WT-012: calculateWeightStats 统计超过 20 条记录不受分页影响', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('25 条记录的统计结果与分页列表无关联', () => {
    for (let i = 1; i <= 25; i++) {
      upsertWeightRecord({ userId: 'user-001', date: `2026-04-${i.toString().padStart(2, '0')}`, morningWeight: 60 + i * 0.1 });
    }
    const stats = calculateWeightStats({ userId: 'user-001' }) as Record<string, unknown>;
    // 第 21 条记录 morningWeight = 60 + 2.1 = 62.1，最小值应该是 60.1（第 1 条），最大值 62.5（第 25 条）
    expect((stats.minWeight as number)).toBeCloseTo(60.1, 1);
    expect((stats.maxWeight as number)).toBeCloseTo(62.5, 1);
    expect((stats.change as number | null)).toBeCloseTo(2.4, 1);
  });
});

describe('WT-013: 无效日期格式被严格校验', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('2024-02-30 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-02-30', morningWeight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('2024-13-01 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-13-01', morningWeight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('2024-00-15 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-00-15', morningWeight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('闰年 2024-02-29 通过', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-02-29', morningWeight: 65.0 }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('非闰年 2023-02-29 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2023-02-29', morningWeight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe('WT-014: NaN 和 Infinity 体重值被拒绝', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    const dbModule = require('../src/db') as typeof import('../src/db');
    dbModule.getDb = () => db;
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  test('NaN morningWeight 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', morningWeight: NaN } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('Infinity morningWeight 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', morningWeight: Infinity } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('-Infinity eveningWeight 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', eveningWeight: -Infinity } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});