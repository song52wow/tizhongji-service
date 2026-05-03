import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import {
  createNotification,
  listNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationById,
} from '../src/notification';
import { resetDb } from '../src/db';

function setupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE notifications (
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
    CREATE INDEX idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX idx_notifications_user_type ON notifications(user_id, type);
    CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, deleted);
  `);
  return db;
}

describe('TC-001: 创建一条合法通知', () => {
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

  test('返回完整通知对象，包含 UUID', () => {
    const input = {
      userId: 'user-123',
      type: 'system' as const,
      title: '系统公告',
      content: '系统将于今晚维护',
    };
    const result = createNotification(input) as { id: string; userId: string; type: string; title: string; content: string; isRead: boolean; priority: string };
    expect(result).toHaveProperty('id');
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result.userId).toBe('user-123');
    expect(result.type).toBe('system');
    expect(result.title).toBe('系统公告');
    expect(result.content).toBe('系统将于今晚维护');
    expect(result.isRead).toBe(false);
    expect(result.priority).toBe('normal');
  });
});

describe('TC-002: 创建标题超过100字符的通知', () => {
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
      userId: 'user-123',
      type: 'system' as const,
      title: 'a'.repeat(101),
      content: '内容',
    };
    const result = createNotification(input) as { success: false; error: string; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toBe('标题长度不能超过100字符');
  });
});

describe('TC-003: 查询某用户的通知列表', () => {
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

  test('返回分页结果，按时间倒序', () => {
    for (let i = 0; i < 5; i++) {
      createNotification({
        userId: 'user-123',
        type: 'order',
        title: `订单通知 ${i}`,
        content: `内容 ${i}`,
      });
      // Small delay to ensure different timestamps
      const start = Date.now();
      while (Date.now() - start < 2) { /* busy wait */ }
    }
    const result = listNotifications({ userId: 'user-123' }) as { items: { title: string }[]; total: number; page: number; pageSize: number };
    expect(result.items).toBeDefined();
    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.items.length).toBe(5);
    // Verify ordering is descending by createdAt (newest first)
    for (let i = 0; i < result.items.length - 1; i++) {
      expect(result.items[i].title).toBe(`订单通知 ${4 - i}`);
    }
  });
});

describe('TC-004: 按 type 过滤通知', () => {
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

  test('仅返回指定类型的通知', () => {
    createNotification({ userId: 'user-123', type: 'system', title: '系统', content: '系统内容' });
    createNotification({ userId: 'user-123', type: 'order', title: '订单', content: '订单内容' });
    createNotification({ userId: 'user-123', type: 'system', title: '系统2', content: '系统内容2' });

    const result = listNotifications({ userId: 'user-123', type: 'system' }) as { items: { type: string }[]; total: number };
    expect(result.total).toBe(2);
    result.items.forEach(item => {
      expect(item.type).toBe('system');
    });
  });
});

describe('TC-005: 标记通知为已读', () => {
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

  test('isRead = true，readAt 记录时间', () => {
    const notification = createNotification({
      userId: 'user-123',
      type: 'message',
      title: '私信',
      content: '你好',
    }) as { id: string };
    const markResult = markAsRead(notification.id, 'user-123');
    expect(markResult).toBe(true);

    const found = getNotificationById(notification.id, 'user-123') as { isRead: boolean; readAt: string };
    expect(found.isRead).toBe(true);
    expect(found.readAt).toBeDefined();
  });

  test('标记不存在的通知返回 404', () => {
    const result = markAsRead(uuidv4(), 'user-123') as { success: false; error: string; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.error).toBe('通知不存在或无权访问');
  });
});

describe('TC-006: 批量标记某用户所有未读通知为已读', () => {
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

  test('返回成功，数量匹配', () => {
    createNotification({ userId: 'user-123', type: 'system', title: '通知1', content: '内容1' });
    createNotification({ userId: 'user-123', type: 'system', title: '通知2', content: '内容2' });
    createNotification({ userId: 'user-123', type: 'system', title: '通知3', content: '内容3' });

    const result = markAllAsRead('user-123') as { success: boolean; count: number };
    expect(result.success).toBe(true);
    expect(result.count).toBe(3);

    const list = listNotifications({ userId: 'user-123' }) as { items: { isRead: boolean }[] };
    list.items.forEach(item => {
      expect(item.isRead).toBe(true);
    });
  });
});

describe('TC-007: 删除已存在通知', () => {
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

  test('再次查询时不再出现', () => {
    const notification = createNotification({
      userId: 'user-123',
      type: 'campaign',
      title: '活动',
      content: '促销活动',
    }) as { id: string };

    const deleteResult = deleteNotification(notification.id, 'user-123');
    expect(deleteResult).toBe(true);

    const list = listNotifications({ userId: 'user-123' }) as { items: { id: string }[] };
    expect(list.items.find(i => i.id === notification.id)).toBeUndefined();
  });

  test('软删除后标记已读返回 404', () => {
    const notification = createNotification({
      userId: 'user-123',
      type: 'campaign',
      title: '活动',
      content: '促销活动',
    }) as { id: string };

    deleteNotification(notification.id, 'user-123');
    const result = markAsRead(notification.id, 'user-123') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });
});

describe('TC-009: 跨用户越权 — 用户 B 无法读取用户 A 的通知', () => {
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

  test('用户 B 调用 getNotificationById 返回 404', () => {
    const notification = createNotification({ userId: 'user-a', type: 'system', title: '通知', content: '内容' }) as { id: string };
    const result = getNotificationById(notification.id, 'user-b') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });
});

describe('TC-010: 跨用户越权 — 用户 B 无法标记用户 A 的通知已读', () => {
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

  test('用户 B 调用 markAsRead 后，用户 A 的通知仍为未读', () => {
    const notification = createNotification({ userId: 'user-a', type: 'system', title: '通知', content: '内容' }) as { id: string };
    const result = markAsRead(notification.id, 'user-b') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    // 用户 A 的通知仍为未读
    const stillUnread = getNotificationById(notification.id, 'user-a') as { isRead: boolean };
    expect(stillUnread.isRead).toBe(false);
  });
});

describe('TC-011: 跨用户越权 — 用户 B 无法删除用户 A 的通知', () => {
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

  test('用户 B 调用 deleteNotification 后，用户 A 仍可查询到该通知', () => {
    const notification = createNotification({ userId: 'user-a', type: 'system', title: '通知', content: '内容' }) as { id: string };
    const result = deleteNotification(notification.id, 'user-b') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    // 用户 A 仍可查询到该通知
    const stillThere = getNotificationById(notification.id, 'user-a') as { id: string };
    expect(stillThere.id).toBe(notification.id);
  });
});

describe('TC-012: markAllAsRead 仅影响当前用户', () => {
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

  test('用户 A 调用 markAllAsRead 只影响用户 A 的通知', () => {
    createNotification({ userId: 'user-a', type: 'system', title: 'A通知1', content: '内容' });
    createNotification({ userId: 'user-a', type: 'system', title: 'A通知2', content: '内容' });
    createNotification({ userId: 'user-b', type: 'system', title: 'B通知', content: '内容' });

    const result = markAllAsRead('user-a') as { success: boolean; count: number };
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);

    const userANotifications = listNotifications({ userId: 'user-a' }) as { items: { isRead: boolean }[] };
    const userBNotifications = listNotifications({ userId: 'user-b' }) as { items: { isRead: boolean }[] };
    userANotifications.items.forEach(item => expect(item.isRead).toBe(true));
    userBNotifications.items.forEach(item => expect(item.isRead).toBe(false));
  });
});