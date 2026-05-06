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

describe('TC-013: 通知 XSS 防护 — title 含 HTML 标签被拒绝', () => {
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

  test('title 含 <script> 返回 400', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '<script>alert(1)</script>', content: '内容' }) as { success: false; statusCode: number; error: string };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain('非法内容');
  });

  test('title 含 <b> 标签 返回 400', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '<b>粗体</b>', content: '内容' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('title 含事件处理器 onload= 返回 400', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题<img onerror="alert(1)">', content: '内容' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('title 含 javascript: 协议 返回 400', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题 javascript:alert(1)', content: '内容' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe('TC-014: 通知 XSS 防护 — content 含非法内容被拒绝', () => {
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

  test('content 含 <div> 标签 返回 400', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题', content: '<div>内容</div>' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('content 含 onmouseover 事件 返回 400', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题', content: '内容<span onmouseover="alert(1)">悬停</span>' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('正常内容通过', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '正常标题', content: '正常内容通过测试，前后无HTML标签' }) as { id: string };
    expect(result).toHaveProperty('id');
  });
});

describe('TC-015: markAllAsRead 仅影响当前用户', () => {
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

describe('TC-016: 内容长度与优先级校验', () => {
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

  test('content = 2000 字符通过', () => {
    const content = 'a'.repeat(2000);
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题', content }) as { id: string };
    expect(result).toHaveProperty('id');
  });

  test('content = 2001 字符被拒绝', () => {
    const content = 'a'.repeat(2001);
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题', content }) as { success: false; statusCode: number; error: string };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain('2000');
  });

  test('content 为空字符串被拒绝', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题', content: '' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('priority=low 正常创建', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题', content: '内容', priority: 'low' }) as { priority: string };
    expect(result.priority).toBe('low');
  });

  test('priority=high 正常创建', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题', content: '内容', priority: 'high' }) as { priority: string };
    expect(result.priority).toBe('high');
  });

  test('priority=urgent（非法值）被拒绝', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '标题', content: '内容', priority: 'urgent' as any }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('title 为空字符串被拒绝', () => {
    const result = createNotification({ userId: 'user-123', type: 'system', title: '', content: '内容' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('type 为空（非法值）被拒绝', () => {
    const result = createNotification({ userId: 'user-123', type: '' as any, title: '标题', content: '内容' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe('TC-017: 分页参数测试', () => {
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
    for (let i = 0; i < 25; i++) {
      createNotification({ userId: 'user-123', type: 'system', title: `通知${i}`, content: '内容' });
    }
    const result = listNotifications({ userId: 'user-123' }) as { page: number; pageSize: number; total: number; items: unknown[] };
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.items.length).toBe(20);
    expect(result.total).toBe(25);
  });

  test('pageSize=5 返回5条', () => {
    for (let i = 0; i < 10; i++) {
      createNotification({ userId: 'user-123', type: 'system', title: `通知${i}`, content: '内容' });
    }
    const result = listNotifications({ userId: 'user-123', pageSize: 5 }) as { items: unknown[]; total: number };
    expect(result.items.length).toBe(5);
    expect(result.total).toBe(10);
  });

  test('page=2 返回后续记录', () => {
    for (let i = 0; i < 10; i++) {
      createNotification({ userId: 'user-123', type: 'system', title: `通知${i}`, content: '内容' });
    }
    const result = listNotifications({ userId: 'user-123', page: 2, pageSize: 5 }) as { items: unknown[] };
    expect(result.items.length).toBe(5);
  });

  test('pageSize 上限为 100', () => {
    const result = listNotifications({ userId: 'user-123', pageSize: 200 }) as { pageSize: number };
    expect(result.pageSize).toBe(100);
  });
});

describe('TC-018: markAllAsRead 边界测试', () => {
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

  test('空 userId 返回 400', () => {
    const result = markAllAsRead('') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('空白 userId 返回 400', () => {
    const result = markAllAsRead('   ') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('无未读通知时返回 count=0', () => {
    createNotification({ userId: 'user-123', type: 'system', title: '已读通知', content: '内容' });
    // mark as read first
    const notif = listNotifications({ userId: 'user-123' }) as { items: { id: string }[] };
    markAsRead(notif.items[0].id, 'user-123');
    // now mark all
    const result = markAllAsRead('user-123') as { success: boolean; count: number };
    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
  });
});

describe('TC-019: listNotifications 边界测试', () => {
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

  test('空 userId 返回 400', () => {
    const result = listNotifications({ userId: '' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('空白 userId 返回 400', () => {
    const result = listNotifications({ userId: '  ' }) as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  test('无通知时返回空数组', () => {
    const result = listNotifications({ userId: 'user-123' }) as { items: unknown[]; total: number };
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('已删除通知不出现', () => {
    const notif = createNotification({ userId: 'user-123', type: 'system', title: '通知', content: '内容' }) as { id: string };
    deleteNotification(notif.id, 'user-123');
    const result = listNotifications({ userId: 'user-123' }) as { items: { id: string }[] };
    expect(result.items.find(i => i.id === notif.id)).toBeUndefined();
  });

  test('filter isRead=false 只返回未读', () => {
    createNotification({ userId: 'user-123', type: 'system', title: '未读', content: '内容' });
    createNotification({ userId: 'user-123', type: 'system', title: '已读', content: '内容' });
    const all = listNotifications({ userId: 'user-123' }) as { items: { id: string }[] };
    markAsRead(all.items[0].id, 'user-123');
    const result = listNotifications({ userId: 'user-123', isRead: false }) as { items: { isRead: boolean }[]; total: number };
    expect(result.total).toBe(1);
    result.items.forEach(item => expect(item.isRead).toBe(false));
  });

  test('filter isRead=true 只返回已读', () => {
    createNotification({ userId: 'user-123', type: 'system', title: '未读', content: '内容' });
    createNotification({ userId: 'user-123', type: 'system', title: '已读', content: '内容' });
    const all = listNotifications({ userId: 'user-123' }) as { items: { id: string }[] };
    markAsRead(all.items[1].id, 'user-123');
    const result = listNotifications({ userId: 'user-123', isRead: true }) as { items: { isRead: boolean }[]; total: number };
    expect(result.total).toBe(1);
    result.items.forEach(item => expect(item.isRead).toBe(true));
  });
});

describe('TC-020: deleteNotification 软删除验证', () => {
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

  test('软删除后 listNotifications 不返回', () => {
    const notif = createNotification({ userId: 'user-123', type: 'system', title: '通知', content: '内容' }) as { id: string };
    deleteNotification(notif.id, 'user-123');
    const result = listNotifications({ userId: 'user-123' }) as { items: unknown[] };
    expect(result.items).toEqual([]);
  });

  test('软删除后 getNotificationById 返回 404', () => {
    const notif = createNotification({ userId: 'user-123', type: 'system', title: '通知', content: '内容' }) as { id: string };
    deleteNotification(notif.id, 'user-123');
    const result = getNotificationById(notif.id, 'user-123') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  test('软删除后再次删除仍返回 404', () => {
    const notif = createNotification({ userId: 'user-123', type: 'system', title: '通知', content: '内容' }) as { id: string };
    deleteNotification(notif.id, 'user-123');
    const result = deleteNotification(notif.id, 'user-123') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  test('hardDelete=true 物理删除', () => {
    const notif = createNotification({ userId: 'user-123', type: 'system', title: '通知', content: '内容' }) as { id: string };
    const result = deleteNotification(notif.id, 'user-123', true);
    expect(result).toBe(true);
  });

  test('不同用户删除返回 404', () => {
    const notif = createNotification({ userId: 'user-a', type: 'system', title: '通知', content: '内容' }) as { id: string };
    const result = deleteNotification(notif.id, 'user-b') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });
});

describe('TC-021: getNotificationById 边界测试', () => {
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

  test('空 userId 返回 404', () => {
    const result = getNotificationById('some-id', '') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  test('空白 userId 返回 404', () => {
    const result = getNotificationById('some-id', '   ') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  test('markAsRead 空白 userId 返回 404', () => {
    const result = markAsRead('some-id', '  ') as { success: false; statusCode: number };
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
  });
});

describe('TC-022: 批量创建通知', () => {
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

  test('批量创建多条通知', () => {
    const { createNotificationsBatch } = require('../src/notification');
    const inputs = Array.from({ length: 5 }, (_, i) => ({
      userId: 'user-123',
      type: 'system' as const,
      title: `批量通知${i}`,
      content: `内容${i}`,
    }));
    const result = createNotificationsBatch(inputs) as unknown[];
    expect(result.length).toBe(5);
  });

  test('超过100条返回 400', () => {
    const { createNotificationsBatch } = require('../src/notification');
    const inputs = Array.from({ length: 101 }, (_, i) => ({
      userId: 'user-123',
      type: 'system' as const,
      title: `通知${i}`,
      content: '内容',
    }));
    const result = createNotificationsBatch(inputs) as { success: false; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain('100');
  });
});