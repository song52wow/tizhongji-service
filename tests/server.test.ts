/**
 * server.test.ts — Integration tests for the HTTP server
 *
 * Run with: NODE_ENV=test npx jest tests/server.test.ts --runInBand --forceExit
 *
 * Uses jest.mock at top-level (hoisted) to inject an in-memory SQLite
 * database before any module that uses it is imported.
 * NODE_ENV=test ensures the server binds to a dynamic port instead of 3000.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import crypto from 'crypto';
import Database from 'better-sqlite3';

// ---- In-memory test DB ----
const testDb = new Database(':memory:');
testDb.pragma('journal_mode = WAL');
testDb.exec(`
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

// ---- Jest mock for db module (hoisted to top of file) ----
jest.mock('../src/db', () => ({
  getDb: () => testDb,
  resetDb: jest.fn(),
  closeDb: jest.fn(),
  initSchema: jest.fn(),
}));

// ---- Import server AFTER mock is active ----
const serverModule = require('../src/server');
const server = serverModule.default;

// ---- Auth helpers ----
const AUTH_SECRET = 'dev-secret-change-in-production';

function makeSignature(userId: string): string {
  return crypto.createHmac('sha256', AUTH_SECRET).update(userId).digest('hex');
}

function authHeaders(userId: string): Record<string, string> {
  return {
    'X-User-Id': userId,
    'X-User-Signature': makeSignature(userId),
    'Content-Type': 'application/json',
  };
}

// ---- Server lifecycle ----
// Server is already listening from the require() above (NODE_ENV=test uses port 0)
// We just need to capture the port it picked.
let serverPort = 0;

beforeAll(async () => {
  // Wait for server to be ready (it started during require)
  await new Promise<void>((resolve) => {
    const checkPort = () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        serverPort = addr.port;
        resolve();
      } else {
        setTimeout(checkPort, 10);
      }
    };
    checkPort();
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => resolve()); });
  testDb.close();
});

// Per-describe block DB reset
afterEach(() => {
  testDb.exec('DELETE FROM notifications');
  testDb.exec('DELETE FROM weight_records');
});

// ---- HTTP request helper ----
async function httpReq(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string } = {}
): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[]> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port: serverPort, method, path, headers: options.headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const headers: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers[k] = v;
          }
          resolve({ statusCode: res.statusCode as number, body: data, headers });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ==================== Auth Middleware Tests ====================

describe('SRV-AUTH-001: Missing X-User-Id header returns 401', () => {
  test('No headers at all', async () => {
    const res = await httpReq('GET', '/weight-records', { headers: {} });
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('未认证');
  });

  test('X-User-Id present but no signature', async () => {
    const res = await httpReq('GET', '/weight-records', {
      headers: { 'x-user-id': 'user-001' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('SRV-AUTH-002: Invalid HMAC signature returns 401', () => {
  test('Wrong signature', async () => {
    const res = await httpReq('GET', '/weight-records', {
      headers: { 'x-user-id': 'user-001', 'x-user-signature': 'invalid' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('Correct userId with wrong signature', async () => {
    const res = await httpReq('GET', '/weight-records', {
      headers: { 'x-user-id': 'user-001', 'x-user-signature': makeSignature('wrong-user') },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('SRV-AUTH-003: Invalid userId format in header returns 401', () => {
  test('userId with spaces', async () => {
    const res = await httpReq('GET', '/weight-records', {
      headers: { 'x-user-id': 'user 001', 'x-user-signature': makeSignature('user 001') },
    });
    expect(res.statusCode).toBe(401);
  });

  test('userId with script tag characters', async () => {
    const uid = 'user<script>';
    const res = await httpReq('GET', '/weight-records', {
      headers: { 'x-user-id': uid, 'x-user-signature': makeSignature(uid) },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ==================== CORS Tests ====================

describe('SRV-CORS-001: CORS headers on preflight OPTIONS', () => {
  test('OPTIONS request returns 204 with allow headers', async () => {
    const res = await httpReq('OPTIONS', '/weight-records', {
      headers: { 'origin': 'http://localhost:3000' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toBeDefined();
    expect(res.headers['access-control-allow-headers']).toBeDefined();
  });
});

describe('SRV-CORS-002: Allowed origin gets CORS headers', () => {
  test('localhost:3000 origin is allowed', async () => {
    const res = await httpReq('GET', '/weight-records', {
      headers: { ...authHeaders('user-001'), 'origin': 'http://localhost:3000' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  test('localhost:8080 origin is allowed', async () => {
    const res = await httpReq('GET', '/weight-records', {
      headers: { ...authHeaders('user-001'), 'origin': 'http://localhost:8080' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8080');
  });
});

// ==================== Weight Record API Tests ====================

describe('SRV-WR-001: POST /weight-records creates a record', () => {
  test('Valid morning record returns 200', async () => {
    const body = JSON.stringify({ date: '2026-04-20', period: 'morning', weight: 65.5 });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.id).toBeDefined();
    expect(data.weight).toBe(65.5);
    expect(data.period).toBe('morning');
  });

  test('Enforces userId from header, ignores body userId', async () => {
    const body = JSON.stringify({ userId: 'attacker-user', date: '2026-04-20', period: 'evening', weight: 64.0 });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.userId).toBe('user-001');
  });
});

describe('SRV-WR-002: POST /weight-records rejects invalid input', () => {
  test('Weight below minimum returns 400', async () => {
    const body = JSON.stringify({ date: '2026-04-20', period: 'morning', weight: 15.0 });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  test('Weight above maximum returns 400', async () => {
    const body = JSON.stringify({ date: '2026-04-20', period: 'morning', weight: 350.0 });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
  });

  test('Invalid period returns 400', async () => {
    const body = JSON.stringify({ date: '2026-04-20', period: 'afternoon', weight: 65.0 });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
  });

  test('Future date returns 400', async () => {
    const body = JSON.stringify({ date: '2099-12-31', period: 'morning', weight: 65.0 });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('超过当前日期');
  });

  test('Invalid date format returns 400', async () => {
    const body = JSON.stringify({ date: 'not-a-date', period: 'morning', weight: 65.0 });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
  });

  test('Note with script tag returns 400', async () => {
    const body = JSON.stringify({ date: '2026-04-20', period: 'morning', weight: 65.0, note: '<script>evil()</script>' });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('非法内容');
  });

  test('NaN weight returns 400', async () => {
    const body = JSON.stringify({ date: '2026-04-20', period: 'morning', weight: NaN });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
  });

  test('Infinity weight returns 400', async () => {
    const body = JSON.stringify({ date: '2026-04-20', period: 'morning', weight: Infinity });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
  });
});

describe('SRV-WR-003: GET /weight-records lists records', () => {
  beforeEach(async () => {
    for (const period of ['morning', 'evening'] as const) {
      const body = JSON.stringify({ date: '2026-04-20', period, weight: 65.0 });
      await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    }
  });

  test('Returns paginated list', async () => {
    const res = await httpReq('GET', '/weight-records', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.items).toBeDefined();
    expect(data.total).toBeGreaterThanOrEqual(2);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
  });

  test('Ignores userId in query string', async () => {
    const res = await httpReq('GET', '/weight-records?userId=attacker-user', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    data.items.forEach((item: any) => {
      expect(item.userId).toBe('user-001');
    });
  });

  test('Period filter works', async () => {
    const res = await httpReq('GET', '/weight-records?period=morning', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    data.items.forEach((item: any) => {
      expect(item.period).toBe('morning');
    });
  });

  test('Date range filter works', async () => {
    const res = await httpReq('GET', '/weight-records?startDate=2026-04-01&endDate=2026-04-30', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    data.items.forEach((item: any) => {
      expect(item.date >= '2026-04-01').toBe(true);
      expect(item.date <= '2026-04-30').toBe(true);
    });
  });

  test('Pagination works', async () => {
    const res = await httpReq('GET', '/weight-records?page=1&pageSize=1', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.items.length).toBeLessThanOrEqual(1);
    expect(data.page).toBe(1);
  });
});

describe('SRV-WR-004: GET /weight-records/:id fetches single record', () => {
  let createdId: string;

  beforeEach(async () => {
    const body = JSON.stringify({ date: '2026-04-21', period: 'morning', weight: 65.0 });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    createdId = JSON.parse(res.body).id;
  });

  test('Returns the record', async () => {
    const res = await httpReq('GET', `/weight-records/${createdId}`, { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.id).toBe(createdId);
  });

  test('Non-existent id returns 404', async () => {
    const res = await httpReq('GET', '/weight-records/non-existent-id', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(404);
  });

  test('Different user cannot access record', async () => {
    const res = await httpReq('GET', `/weight-records/${createdId}`, { headers: authHeaders('user-002') });
    expect(res.statusCode).toBe(404);
  });
});

describe('SRV-WR-005: DELETE /weight-records/:id deletes record', () => {
  let createdId: string;

  beforeEach(async () => {
    const body = JSON.stringify({ date: '2026-04-22', period: 'morning', weight: 65.0 });
    const res = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body });
    createdId = JSON.parse(res.body).id;
  });

  test('Deletes successfully', async () => {
    const res = await httpReq('DELETE', `/weight-records/${createdId}`, { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
  });

  test('Deleted record no longer appears in list', async () => {
    await httpReq('DELETE', `/weight-records/${createdId}`, { headers: authHeaders('user-001') });
    const res = await httpReq('GET', '/weight-records', { headers: authHeaders('user-001') });
    const data = JSON.parse(res.body);
    expect(data.items.find((r: any) => r.id === createdId)).toBeUndefined();
  });

  test('Non-existent id returns 404', async () => {
    const res = await httpReq('DELETE', '/weight-records/fake-id', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(404);
  });

  test('Different user cannot delete', async () => {
    const res = await httpReq('DELETE', `/weight-records/${createdId}`, { headers: authHeaders('user-002') });
    expect(res.statusCode).toBe(404);
  });
});

describe('SRV-WR-006: GET /weight-records/stats returns statistics', () => {
  beforeEach(async () => {
    const records = [
      { date: '2026-04-18', period: 'morning', weight: 66.0 },
      { date: '2026-04-18', period: 'evening', weight: 65.5 },
      { date: '2026-04-19', period: 'morning', weight: 65.8 },
      { date: '2026-04-19', period: 'evening', weight: 65.2 },
    ];
    for (const r of records) {
      await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body: JSON.stringify(r) });
    }
  });

  test('Returns stats with all required fields', async () => {
    const res = await httpReq('GET', '/weight-records/stats', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty('avgMorningWeight');
    expect(data).toHaveProperty('avgEveningWeight');
    expect(data).toHaveProperty('minWeight');
    expect(data).toHaveProperty('maxWeight');
    expect(data).toHaveProperty('change');
    expect(data).toHaveProperty('avgWeightDiff');
  });

  test('Stats filtered by date range', async () => {
    const res = await httpReq(
      'GET',
      '/weight-records/stats?startDate=2026-04-18&endDate=2026-04-19',
      { headers: authHeaders('user-001') }
    );
    expect(res.statusCode).toBe(200);
  });
});

// ==================== Notification API Tests ====================

describe('SRV-NOTIF-001: POST /notifications creates a notification', () => {
  test('Valid notification returns 200', async () => {
    const body = JSON.stringify({ type: 'system', title: '测试通知', content: '测试内容' });
    const res = await httpReq('POST', '/notifications', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.id).toBeDefined();
    expect(data.title).toBe('测试通知');
    expect(data.isRead).toBe(false);
  });

  test('Enforces userId from header', async () => {
    const body = JSON.stringify({ userId: 'attacker', type: 'system', title: '入侵', content: '内容' });
    const res = await httpReq('POST', '/notifications', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.userId).toBe('user-001');
  });

  test('Title too long returns 400', async () => {
    const body = JSON.stringify({ type: 'system', title: 'a'.repeat(101), content: '内容' });
    const res = await httpReq('POST', '/notifications', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('100');
  });

  test('XSS in title returns 400', async () => {
    const body = JSON.stringify({ type: 'system', title: '<script>alert(1)</script>', content: '内容' });
    const res = await httpReq('POST', '/notifications', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('非法内容');
  });

  test('XSS in content returns 400', async () => {
    const body = JSON.stringify({ type: 'system', title: '标题', content: '<img onerror="alert(1)">' });
    const res = await httpReq('POST', '/notifications', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
  });

  test('Invalid type returns 400', async () => {
    const body = JSON.stringify({ type: 'invalid-type', title: '标题', content: '内容' });
    const res = await httpReq('POST', '/notifications', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(400);
  });

  test('Priority high works', async () => {
    const body = JSON.stringify({ type: 'system', title: '高优先级', content: '内容', priority: 'high' });
    const res = await httpReq('POST', '/notifications', { headers: authHeaders('user-001'), body });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.priority).toBe('high');
  });
});

describe('SRV-NOTIF-002: GET /notifications lists notifications', () => {
  beforeEach(async () => {
    for (const type of ['system', 'order', 'message'] as const) {
      await httpReq('POST', '/notifications', {
        headers: authHeaders('user-001'),
        body: JSON.stringify({ type, title: `${type} title`, content: 'content' }),
      });
    }
  });

  test('Returns paginated notifications', async () => {
    const res = await httpReq('GET', '/notifications', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.items).toBeDefined();
    expect(data.total).toBeGreaterThanOrEqual(3);
    expect(data.page).toBe(1);
  });

  test('Filter by isRead=true works', async () => {
    const listRes = await httpReq('GET', '/notifications', { headers: authHeaders('user-001') });
    const items = JSON.parse(listRes.body).items;
    await httpReq('POST', `/notifications/${items[0].id}`, { headers: authHeaders('user-001') });

    const res = await httpReq('GET', '/notifications?isRead=true', { headers: authHeaders('user-001') });
    const data = JSON.parse(res.body);
    data.items.forEach((item: any) => {
      expect(item.isRead).toBe(true);
    });
  });

  test('Filter by type works', async () => {
    const res = await httpReq('GET', '/notifications?type=system', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    data.items.forEach((item: any) => {
      expect(item.type).toBe('system');
    });
  });
});

describe('SRV-NOTIF-003: POST /notifications/:id marks as read', () => {
  let notifId: string;

  beforeEach(async () => {
    const res = await httpReq('POST', '/notifications', {
      headers: authHeaders('user-001'),
      body: JSON.stringify({ type: 'system', title: '待读', content: 'content' }),
    });
    notifId = JSON.parse(res.body).id;
  });

  test('Marks notification as read', async () => {
    const res = await httpReq('POST', `/notifications/${notifId}`, { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
  });

  test('Non-existent notification returns 404', async () => {
    const res = await httpReq('POST', '/notifications/fake-notif-id', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(404);
  });

  test('Different user cannot mark as read', async () => {
    const res = await httpReq('POST', `/notifications/${notifId}`, { headers: authHeaders('user-002') });
    expect(res.statusCode).toBe(404);
  });
});

describe('SRV-NOTIF-004: POST /notifications/read-all marks all as read', () => {
  beforeEach(async () => {
    for (let i = 0; i < 3; i++) {
      await httpReq('POST', '/notifications', {
        headers: authHeaders('user-001'),
        body: JSON.stringify({ type: 'system', title: `通知${i}`, content: 'content' }),
      });
    }
  });

  test('Marks all unread as read', async () => {
    const res = await httpReq('POST', '/notifications/read-all', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.success).toBe(true);
    expect(data.count).toBeGreaterThanOrEqual(3);
  });

  test('Only affects current user', async () => {
    await httpReq('POST', '/notifications', {
      headers: authHeaders('user-002'),
      body: JSON.stringify({ type: 'system', title: 'user-002 notif', content: 'content' }),
    });

    await httpReq('POST', '/notifications/read-all', { headers: authHeaders('user-001') });

    const res = await httpReq('GET', '/notifications', { headers: authHeaders('user-002') });
    const data = JSON.parse(res.body);
    expect(data.items[0].isRead).toBe(false);
  });
});

describe('SRV-NOTIF-005: DELETE /notifications/:id deletes notification', () => {
  let notifId: string;

  beforeEach(async () => {
    const res = await httpReq('POST', '/notifications', {
      headers: authHeaders('user-001'),
      body: JSON.stringify({ type: 'system', title: '待删', content: 'content' }),
    });
    notifId = JSON.parse(res.body).id;
  });

  test('Deletes successfully', async () => {
    const res = await httpReq('DELETE', `/notifications/${notifId}`, { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
  });

  test('Deleted notification no longer appears in list', async () => {
    await httpReq('DELETE', `/notifications/${notifId}`, { headers: authHeaders('user-001') });
    const res = await httpReq('GET', '/notifications', { headers: authHeaders('user-001') });
    const data = JSON.parse(res.body);
    expect(data.items.find((r: any) => r.id === notifId)).toBeUndefined();
  });

  test('Non-existent id returns 404', async () => {
    const res = await httpReq('DELETE', '/notifications/fake-id', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(404);
  });

  test('Different user cannot delete', async () => {
    const res = await httpReq('DELETE', `/notifications/${notifId}`, { headers: authHeaders('user-002') });
    expect(res.statusCode).toBe(404);
  });
});

describe('SRV-NOTIF-006: GET /notifications/:id fetches single notification', () => {
  test('Returns the notification', async () => {
    const createRes = await httpReq('POST', '/notifications', {
      headers: authHeaders('user-001'),
      body: JSON.stringify({ type: 'system', title: 'Test', content: 'content' }),
    });
    const id = JSON.parse(createRes.body).id;

    const res = await httpReq('GET', `/notifications/${id}`, { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.id).toBe(id);
  });

  test('Non-existent returns 404', async () => {
    const res = await httpReq('GET', '/notifications/non-existent', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(404);
  });
});

// ==================== Error Handling Tests ====================

describe('SRV-ERR-001: Invalid JSON body returns 500', () => {
  test('Malformed JSON', async () => {
    const res = await httpReq('POST', '/weight-records', {
      headers: { ...authHeaders('user-001'), 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('服务器错误');
  });
});

describe('SRV-ERR-002: Unknown route returns 404', () => {
  test('GET /unknown-route', async () => {
    const res = await httpReq('GET', '/unknown-route', { headers: authHeaders('user-001') });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ success: false, error: 'Not Found' });
  });

  test('POST /weight-records with unknown sub-path', async () => {
    const res = await httpReq('POST', '/weight-records/unknown-action', {
      headers: authHeaders('user-001'),
      body: '{}',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('SRV-ERR-003: Empty body returns appropriate error', () => {
  test('POST /weight-records with empty body', async () => {
    const res = await httpReq('POST', '/weight-records', {
      headers: { ...authHeaders('user-001'), 'Content-Type': 'application/json' },
      body: '',
    });
    expect(res.statusCode).toBe(500);
  });
});

describe('SRV-ERR-004: Upsert — same user/date/period updates (not duplicates)', () => {
  test('POST same record twice updates weight', async () => {
    const body1 = JSON.stringify({ date: '2026-04-25', period: 'morning', weight: 65.0 });
    await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body: body1 });

    const body2 = JSON.stringify({ date: '2026-04-25', period: 'morning', weight: 64.5 });
    const res2 = await httpReq('POST', '/weight-records', { headers: authHeaders('user-001'), body: body2 });
    expect(res2.statusCode).toBe(200);
    const data2 = JSON.parse(res2.body);
    expect(data2.weight).toBe(64.5);

    const listRes = await httpReq('GET', '/weight-records?startDate=2026-04-25&endDate=2026-04-25', {
      headers: authHeaders('user-001'),
    });
    const listData = JSON.parse(listRes.body);
    const morning = listData.items.filter((r: any) => r.period === 'morning');
    expect(morning.length).toBe(1);
  });
});
