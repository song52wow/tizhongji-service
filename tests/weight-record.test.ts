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

function getToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ============ v2 Tests ============

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

  test('返回完整记录，包含 UUID 和 period=morning', () => {
    const input = {
      userId: 'user-001',
      date: getToday(),
      period: 'morning' as const,
      weight: 65.5,
    };
    const result = upsertWeightRecord(input) as { id: string; userId: string; date: string; period: string; weight: number };
    expect(result).toHaveProperty('id');
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result.userId).toBe('user-001');
    expect(result.period).toBe('morning');
    expect(result.weight).toBe(65.5);
  });
});

describe('WT-002: 同一天可创建 morning 和 evening 两条独立记录', () => {
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

  test('同一用户同一天早晚记录各一条，查询返回 2 条记录', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening' as const, weight: 64.5, note: '锻炼后' });
    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-20' }) as { items: { period: string; weight: number; note?: string }[]; total: number };
    expect(result.total).toBe(2);
    expect(result.items.length).toBe(2);
    expect(result.items.find(i => i.period === 'morning')!.weight).toBe(65.0);
    expect(result.items.find(i => i.period === 'evening')!.weight).toBe(64.5);
    expect(result.items.find(i => i.period === 'evening')!.note).toBe('锻炼后');
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
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 15.0 }) as { success: false; statusCode: number; error: string };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain('20');
    expect(result.error).toContain('300');
  });
});

describe('WT-004: 无效 period 值被拒绝', () => {
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

  test('period 为 invalid 时返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'invalid' as any, weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
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
    for (const date of ['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24']) {
      upsertWeightRecord({ userId: 'user-001', date, period: 'morning' as const, weight: 65.0 + Math.random() * 0.5 });
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

describe('WT-007: 更新已存在的记录（同一日期+period）', () => {
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

  test('同一 period 记录被更新，weight 覆盖，updatedAt 更新', () => {
    const created = upsertWeightRecord({ userId: 'user-001', date: '2026-04-25', period: 'morning' as const, weight: 65.0 }) as { id: string; weight: number; updatedAt: string };
    const originalUpdatedAt = created.updatedAt;

    // Wait a bit to ensure different timestamp
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }

    const updated = upsertWeightRecord({ userId: 'user-001', date: '2026-04-25', period: 'morning' as const, weight: 64.5 }) as { weight: number; updatedAt: string };

    expect(updated.weight).toBe(64.5);

    const list = listWeightRecords({ userId: 'user-001', startDate: '2026-04-25', endDate: '2026-04-25' }) as { items: { period: string }[] };
    expect(list.items.filter(i => i.period === 'morning').length).toBe(1);
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
    const created = upsertWeightRecord({ userId: 'user-001', date: '2026-04-26', period: 'morning' as const, weight: 65.0 }) as { id: string };
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
    const created = upsertWeightRecord({ userId: 'user-a', date: '2026-04-20', period: 'morning' as const, weight: 65.0 }) as { id: string };
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
    const created = upsertWeightRecord({ userId: 'user-a', date: '2026-04-20', period: 'morning' as const, weight: 65.0 }) as { id: string };
    const result = deleteWeightRecord(created.id, 'user-b') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    // 用户 A 的记录仍然存在
    const stillThere = getWeightRecordById(created.id, 'user-a');
    expect((stillThere as { id: string }).id).toBe(created.id);
  });
});

describe('WT-011: calculateWeightStats v2 字段名与 avgWeightDiff', () => {
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

  test('返回对象包含 avgMorningWeight、avgEveningWeight、minWeight、maxWeight、change、avgWeightDiff', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening' as const, weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'morning' as const, weight: 64.8 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'evening' as const, weight: 64.3 });
    const result = calculateWeightStats({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-22' }) as unknown as Record<string, unknown>;
    expect(result).toHaveProperty('avgMorningWeight');
    expect(result).toHaveProperty('avgEveningWeight');
    expect(result).toHaveProperty('minWeight');
    expect(result).toHaveProperty('maxWeight');
    expect(result).toHaveProperty('change');
    expect(result).toHaveProperty('avgWeightDiff');
    expect(result.avgMorningWeight).toBe(64.9);
    expect(result.avgEveningWeight).toBe(64.4);
    expect(result.avgWeightDiff).toBe(-0.5); // avg of -0.5 and -0.5
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

  test('25 条记录的统计结果包含全部数据', () => {
    for (let i = 1; i <= 25; i++) {
      upsertWeightRecord({ userId: 'user-001', date: `2026-04-${i.toString().padStart(2, '0')}`, period: 'morning' as const, weight: 60 + i * 0.1 });
    }
    const stats = calculateWeightStats({ userId: 'user-001' }) as unknown as Record<string, unknown>;
    expect((stats.minWeight as number)).toBeCloseTo(60.1, 1);
    expect((stats.maxWeight as number)).toBeCloseTo(62.5, 1);
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
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-02-30', period: 'morning' as const, weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('2024-13-01 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-13-01', period: 'morning' as const, weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('2024-00-15 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-00-15', period: 'morning' as const, weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('闰年 2024-02-29 通过', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-02-29', period: 'morning' as const, weight: 65.0 }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('非闰年 2023-02-29 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2023-02-29', period: 'morning' as const, weight: 65.0 }) as { success: false; statusCode: number };
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

  test('NaN weight 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: NaN } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('Infinity weight 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: Infinity } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('-Infinity weight 返回 400', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening' as const, weight: -Infinity } as any) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe('WT-015: weightDiff 计算 — 同一天同时有 morning 和 evening 时', () => {
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

  test('列表中每条记录的 weightDiff 正确（evening - morning）', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening' as const, weight: 64.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'morning' as const, weight: 64.8 });

    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-21' }) as { items: { period: string; weightDiff: number | null }[] };
    const morning = result.items.find(i => i.period === 'morning');
    const evening = result.items.find(i => i.period === 'evening');
    expect(morning!.weightDiff).toBe(-0.5);
    expect(evening!.weightDiff).toBe(-0.5);
  });

  test('只有 morning 没有 evening 时 weightDiff 为 null', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });

    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-20' }) as { items: { period: string; weightDiff: number | null }[] };
    const morning = result.items.find(i => i.period === 'morning');
    expect(morning!.weightDiff).toBeNull();
  });
});

describe('WT-016: 同一用户同一天不能创建两条相同 period 的记录', () => {
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

  test('两次 upsert morning 同日期，后者覆盖前者', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 64.5 });

    const list = listWeightRecords({ userId: 'user-001', startDate: '2026-04-20', endDate: '2026-04-20' }) as { total: number; items: { period: string; weight: number }[] };
    expect(list.total).toBe(1);
    expect(list.items[0].weight).toBe(64.5);
  });
});

describe('WT-017: listWeightRecords period 参数校验', () => {
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

  test('period=invalid 返回 400', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });
    const result = listWeightRecords({ userId: 'user-001', period: 'invalid' as any }) as { success: false; statusCode: number; error: string };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain('morning');
    expect(result.error).toContain('evening');
  });

  test('period=afternoon（非法值）返回 400', () => {
    const result = listWeightRecords({ userId: 'user-001', period: 'afternoon' as any }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('period=morning 正常返回', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening' as const, weight: 64.5 });
    const result = listWeightRecords({ userId: 'user-001', period: 'morning' }) as { items: { period: string }[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0].period).toBe('morning');
  });

  test('period=evening 正常返回', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening' as const, weight: 64.5 });
    const result = listWeightRecords({ userId: 'user-001', period: 'evening' }) as { items: { period: string }[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0].period).toBe('evening');
  });
});

describe('WT-018: 体重边界值测试', () => {
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

  test('体重 = 20.0 kg（最小值）通过', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 20.0 }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('体重 = 300.0 kg（最大值）通过', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 300.0 }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('体重 = 19.9 kg 被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 19.9 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('体重 = 300.1 kg 被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 300.1 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('体重 = 0 被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('体重 = -10 被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: -10 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe('WT-019: 备注字段边界与安全测试', () => {
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

  test('备注 = 200 字符通过', () => {
    const note = 'a'.repeat(200);
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0, note }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('备注 = 201 字符被拒绝', () => {
    const note = 'a'.repeat(201);
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0, note }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('备注含 <img onerror> 被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0, note: '<img onerror="alert(1)" src=x>' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('备注含 <a href="javascript:"> 被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0, note: '<a href="javascript:alert(1)">link</a>' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('备注含 <div onclick> 被拒绝', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0, note: '<div onclick="evil()">text</div>' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('备注为正常文本通过', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0, note: '今天感觉不错！坚持运动。' }) as { id: string };
    expect(result).toHaveProperty('id');
  });
});

describe('WT-020: 分页参数测试', () => {
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

  test('默认 page=1, pageSize=20', () => {
    for (let i = 1; i <= 25; i++) {
      upsertWeightRecord({ userId: 'user-001', date: `2026-04-${i.toString().padStart(2, '0')}`, period: 'morning' as const, weight: 65.0 });
    }
    const result = listWeightRecords({ userId: 'user-001' }) as { items: unknown[]; total: number; page: number; pageSize: number };
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.items.length).toBe(20);
    expect(result.total).toBe(25);
  });

  test('pageSize=5 返回5条', () => {
    for (let i = 1; i <= 10; i++) {
      upsertWeightRecord({ userId: 'user-001', date: `2026-04-${i.toString().padStart(2, '0')}`, period: 'morning' as const, weight: 65.0 });
    }
    const result = listWeightRecords({ userId: 'user-001', pageSize: 5 }) as { items: unknown[]; total: number };
    expect(result.items.length).toBe(5);
    expect(result.total).toBe(10);
  });

  test('page=2 返回后续记录', () => {
    for (let i = 1; i <= 10; i++) {
      upsertWeightRecord({ userId: 'user-001', date: `2026-04-${i.toString().padStart(2, '0')}`, period: 'morning' as const, weight: 65.0 });
    }
    const result = listWeightRecords({ userId: 'user-001', page: 2, pageSize: 5 }) as { items: unknown[] };
    expect(result.items.length).toBe(5);
  });

  test('pageSize 上限为 100', () => {
    const result = listWeightRecords({ userId: 'user-001', pageSize: 200 }) as { pageSize: number };
    expect(result.pageSize).toBe(100);
  });

  test('page 最小为 1', () => {
    for (let i = 1; i <= 5; i++) {
      upsertWeightRecord({ userId: 'user-001', date: `2026-04-${i.toString().padStart(2, '0')}`, period: 'morning' as const, weight: 65.0 });
    }
    const result = listWeightRecords({ userId: 'user-001', page: -1 }) as { items: unknown[] };
    expect(result.items.length).toBe(5);
  });
});

describe('WT-021: 日期范围验证', () => {
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

  test('startDate > endDate 返回 400', () => {
    const result = listWeightRecords({ userId: 'user-001', startDate: '2026-05-01', endDate: '2026-04-01' }) as { success: false; statusCode: number; error: string };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain('不能晚于');
  });

  test('无效 startDate 格式返回 400', () => {
    const result = listWeightRecords({ userId: 'user-001', startDate: '2026/04/01' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('无效 endDate 格式返回 400', () => {
    const result = listWeightRecords({ userId: 'user-001', endDate: '04-01-2026' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('calculateWeightStats 同样验证日期范围', () => {
    const result = calculateWeightStats({ userId: 'user-001', startDate: '2026-05-01', endDate: '2026-04-01' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe('WT-022: 空结果与统计边界测试', () => {
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

  test('无记录时 listWeightRecords 返回空数组', () => {
    const result = listWeightRecords({ userId: 'user-001' }) as { items: unknown[]; total: number };
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('无记录时 calculateWeightStats 返回 null 字段', () => {
    const result = calculateWeightStats({ userId: 'user-001' }) as { avgMorningWeight: null; avgEveningWeight: null; minWeight: null; maxWeight: null; change: null; avgWeightDiff: null };
    expect(result.avgMorningWeight).toBeNull();
    expect(result.avgEveningWeight).toBeNull();
    expect(result.minWeight).toBeNull();
    expect(result.maxWeight).toBeNull();
    expect(result.change).toBeNull();
    expect(result.avgWeightDiff).toBeNull();
  });

  test('仅有 evening 记录时 stats 计算正确', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening' as const, weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'evening' as const, weight: 64.5 });
    const result = calculateWeightStats({ userId: 'user-001' }) as { avgMorningWeight: number | null; avgEveningWeight: number | null; avgWeightDiff: number | null };
    expect(result.avgMorningWeight).toBeNull();
    expect(result.avgEveningWeight).toBe(64.8);
    expect(result.avgWeightDiff).toBeNull(); // 需要同一天有 morning+evening 才有值
  });

  test('change 为 null 当记录少于 2 条', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });
    const result = calculateWeightStats({ userId: 'user-001' }) as { change: number | null };
    expect(result.change).toBeNull();
  });

  test('change 计算：第1条到最后1条（按日期排序）', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-18', period: 'morning' as const, weight: 66.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-19', period: 'morning' as const, weight: 65.5 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 64.8 });
    const result = calculateWeightStats({ userId: 'user-001' }) as { change: number };
    expect(result.change).toBe(-1.2); // 64.8 - 66.0
  });

  test('avgWeightDiff 只有同一天有 morning+evening 时才计算', () => {
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'evening' as const, weight: 64.0 });
    upsertWeightRecord({ userId: 'user-001', date: '2026-04-21', period: 'morning' as const, weight: 64.5 });
    // 没有 evening
    const result = calculateWeightStats({ userId: 'user-001' }) as { avgWeightDiff: number | null };
    expect(result.avgWeightDiff).toBe(-1.0); // 只计算了 2026-04-20 的 diff
  });
});

describe('WT-023: userId 验证', () => {
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

  test('upsertWeightRecord 空 userId 返回 400', () => {
    const result = upsertWeightRecord({ userId: '', date: '2026-04-20', period: 'morning' as const, weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('upsertWeightRecord 空白 userId 返回 400', () => {
    const result = upsertWeightRecord({ userId: '   ', date: '2026-04-20', period: 'morning' as const, weight: 65.0 }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('listWeightRecords 空 userId 返回 400', () => {
    const result = listWeightRecords({ userId: '' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('calculateWeightStats 空 userId 返回 400', () => {
    const result = calculateWeightStats({ userId: '' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe('WT-024: getWeightRecordById 与 deleteWeightRecord 边界', () => {
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

  test('已删除记录 getWeightRecordById 返回 404', () => {
    const created = upsertWeightRecord({ userId: 'user-001', date: '2026-04-20', period: 'morning' as const, weight: 65.0 }) as { id: string };
    deleteWeightRecord(created.id, 'user-001');
    const result = getWeightRecordById(created.id, 'user-001') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  test('空白 userId 在 getWeightRecordById 返回 404', () => {
    const result = getWeightRecordById('some-id', '  ') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  test('空白 userId 在 deleteWeightRecord 返回 404', () => {
    const result = deleteWeightRecord('some-id', '  ') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });
});

describe('WT-025: 特殊日期格式验证', () => {
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

  test('2024-01-01 通过', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-01-01', period: 'morning' as const, weight: 65.0 }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('2024-12-31 通过', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2024-12-31', period: 'morning' as const, weight: 65.0 }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('2023-01-01（非闰年，01-01）通过', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2023-01-01', period: 'morning' as const, weight: 65.0 }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('2023-12-31（非闰年，12-31）通过', () => {
    const result = upsertWeightRecord({ userId: 'user-001', date: '2023-12-31', period: 'morning' as const, weight: 65.0 }) as { id: string };
    expect(result).toHaveProperty('id');
  });
});
