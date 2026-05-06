import { test, expect, request } from '@playwright/test';
import { generateAuthHeaders, TEST_USER_A, TEST_USER_B } from './auth';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

async function createNotification(
  baseURL: string,
  userId: string,
  type: string,
  title: string,
  content: string,
  priority?: string
) {
  const ctx = await request.newContext({ baseURL });
  const headers = generateAuthHeaders(userId);
  const body: Record<string, string> = { type, title, content };
  if (priority) body.priority = priority;
  return ctx.post('/notifications', { headers, data: body });
}

async function listNotifications(
  baseURL: string,
  userId: string,
  params?: Record<string, string>
) {
  const ctx = await request.newContext({ baseURL });
  const headers = generateAuthHeaders(userId);
  return ctx.get('/notifications', { headers, params });
}

test.describe('Notification E2E', () => {
  test.beforeEach(async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const resp = await ctx.get('/notifications', { headers, params: { pageSize: '100' } });
    const body = await resp.json();
    for (const item of body.items || []) {
      await ctx.delete(`/notifications/${item.id}`, { headers });
    }
  });

  test('E2E-NOTIF-001: create notification', async () => {
    const resp = await createNotification(BASE_URL, TEST_USER_A, 'system', '欢迎使用', '欢迎使用本系统');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.id).toBeDefined();
    expect(body.userId).toBe(TEST_USER_A);
    expect(body.type).toBe('system');
    expect(body.title).toBe('欢迎使用');
    expect(body.content).toBe('欢迎使用本系统');
    expect(body.isRead).toBe(false);
    expect(body.priority).toBe('normal');
    expect(body.createdAt).toBeDefined();
  });

  test('E2E-NOTIF-002: create notification with priority', async () => {
    const resp = await createNotification(BASE_URL, TEST_USER_A, 'system', '重要通知', '紧急内容', 'high');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.priority).toBe('high');
  });

  test('E2E-NOTIF-003: create notification with all types', async () => {
    const types = ['system', 'order', 'message', 'campaign'];
    for (const type of types) {
      const resp = await createNotification(BASE_URL, TEST_USER_A, type, `标题-${type}`, `内容-${type}`);
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.type).toBe(type);
    }
  });

  test('E2E-NOTIF-004: invalid type rejected', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const resp = await ctx.post('/notifications', {
      headers,
      data: { type: 'invalid', title: 'Test', content: 'Content' },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('system');
  });

  test('E2E-NOTIF-005: invalid priority rejected', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const resp = await ctx.post('/notifications', {
      headers,
      data: { type: 'system', title: 'Test', content: 'Content', priority: 'urgent' },
    });
    expect(resp.status()).toBe(400);
  });

  test('E2E-NOTIF-006: title too long (>100 chars) rejected', async () => {
    const longTitle = 'A'.repeat(101);
    const resp = await createNotification(BASE_URL, TEST_USER_A, 'system', longTitle, 'Content');
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('100');
  });

  test('E2E-NOTIF-007: content too long (>2000 chars) rejected', async () => {
    const longContent = 'A'.repeat(2001);
    const resp = await createNotification(BASE_URL, TEST_USER_A, 'system', 'Title', longContent);
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('2000');
  });

  test('E2E-NOTIF-008: HTML in title rejected', async () => {
    const resp = await createNotification(BASE_URL, TEST_USER_A, 'system', '<b>Bold</b>', 'Content');
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('非法内容');
  });

  test('E2E-NOTIF-009: list notifications - ordered by createdAt DESC', async () => {
    await createNotification(BASE_URL, TEST_USER_A, 'system', 'First', 'First content');
    await createNotification(BASE_URL, TEST_USER_A, 'system', 'Second', 'Second content');

    const resp = await listNotifications(BASE_URL, TEST_USER_A);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.items.length).toBe(2);
    expect(body.items[0].title).toBe('Second'); // Most recent first
    expect(body.items[1].title).toBe('First');
  });

  test('E2E-NOTIF-010: filter by type', async () => {
    await createNotification(BASE_URL, TEST_USER_A, 'system', 'System 1', 'C');
    await createNotification(BASE_URL, TEST_USER_A, 'order', 'Order 1', 'C');

    const resp = await listNotifications(BASE_URL, TEST_USER_A, { type: 'system' });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.items.every((i: any) => i.type === 'system')).toBe(true);
  });

  test('E2E-NOTIF-011: filter by isRead', async () => {
    const resp1 = await createNotification(BASE_URL, TEST_USER_A, 'system', 'Unread', 'C');
    const notif = await resp1.json();

    // Mark as read
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    await ctx.post(`/notifications/${notif.id}`, { headers });

    const unreadResp = await listNotifications(BASE_URL, TEST_USER_A, { isRead: 'false' });
    expect(unreadResp.status()).toBe(200);
    const unreadBody = await unreadResp.json();
    expect(unreadBody.items.every((i: any) => i.isRead === false)).toBe(true);

    const readResp = await listNotifications(BASE_URL, TEST_USER_A, { isRead: 'true' });
    const readBody = await readResp.json();
    expect(readBody.items.some((i: any) => i.id === notif.id)).toBe(true);
  });

  test('E2E-NOTIF-012: mark notification as read', async () => {
    const createResp = await createNotification(BASE_URL, TEST_USER_A, 'system', 'Test', 'Content');
    const notif = await createResp.json();
    expect(notif.isRead).toBe(false);

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const markResp = await ctx.post(`/notifications/${notif.id}`, { headers });
    expect(markResp.status()).toBe(200);
    const markBody = await markResp.json();
    expect(markBody.success).toBe(true);

    // Verify read status
    const getResp = await ctx.get(`/notifications/${notif.id}`, { headers });
    const getBody = await getResp.json();
    expect(getBody.isRead).toBe(true);
    expect(getBody.readAt).toBeDefined();
  });

  test('E2E-NOTIF-013: mark all notifications as read', async () => {
    await createNotification(BASE_URL, TEST_USER_A, 'system', 'N1', 'C');
    await createNotification(BASE_URL, TEST_USER_A, 'system', 'N2', 'C');
    await createNotification(BASE_URL, TEST_USER_A, 'system', 'N3', 'C');

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const resp = await ctx.post('/notifications/read-all', { headers });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(3);

    // Verify all are read
    const listResp = await ctx.get('/notifications', { headers });
    const listBody = await listResp.json();
    expect(listBody.items.every((i: any) => i.isRead === true)).toBe(true);
  });

  test('E2E-NOTIF-014: soft delete notification', async () => {
    const createResp = await createNotification(BASE_URL, TEST_USER_A, 'system', 'ToDelete', 'Content');
    const notif = await createResp.json();

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const delResp = await ctx.delete(`/notifications/${notif.id}`, { headers });
    expect(delResp.status()).toBe(200);
    const delBody = await delResp.json();
    expect(delBody.success).toBe(true);

    // Verify deleted
    const getResp = await ctx.get(`/notifications/${notif.id}`, { headers });
    expect(getResp.status()).toBe(404);
  });

  test('E2E-NOTIF-015: pagination works', async () => {
    for (let i = 0; i < 5; i++) {
      await createNotification(BASE_URL, TEST_USER_A, 'system', `N${i}`, `C${i}`);
    }

    const resp = await listNotifications(BASE_URL, TEST_USER_A, { page: '1', pageSize: '2' });
    const body = await resp.json();
    expect(body.items.length).toBe(2);
    expect(body.total).toBe(5);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
  });

  test('E2E-NOTIF-016: cross-user - user B cannot read user A notification', async () => {
    const createResp = await createNotification(BASE_URL, TEST_USER_A, 'system', 'Private', 'Content');
    const notif = await createResp.json();

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headersB = generateAuthHeaders(TEST_USER_B);
    const getResp = await ctx.get(`/notifications/${notif.id}`, { headers: headersB });
    expect(getResp.status()).toBe(404);
  });

  test('E2E-NOTIF-017: cross-user - user B cannot mark user A notification as read', async () => {
    const createResp = await createNotification(BASE_URL, TEST_USER_A, 'system', 'Private', 'Content');
    const notif = await createResp.json();

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headersB = generateAuthHeaders(TEST_USER_B);
    const markResp = await ctx.post(`/notifications/${notif.id}`, { headers: headersB });
    expect(markResp.status()).toBe(404);

    // Verify still unread for user A
    const headersA = generateAuthHeaders(TEST_USER_A);
    const getResp = await ctx.get(`/notifications/${notif.id}`, { headers: headersA });
    const getBody = await getResp.json();
    expect(getBody.isRead).toBe(false);
  });

  test('E2E-NOTIF-018: cross-user - user B cannot delete user A notification', async () => {
    const createResp = await createNotification(BASE_URL, TEST_USER_A, 'system', 'Private', 'Content');
    const notif = await createResp.json();

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headersB = generateAuthHeaders(TEST_USER_B);
    const delResp = await ctx.delete(`/notifications/${notif.id}`, { headers: headersB });
    expect(delResp.status()).toBe(404);
  });

  test('E2E-NOTIF-019: get single notification', async () => {
    const createResp = await createNotification(BASE_URL, TEST_USER_A, 'system', 'Detail', 'Content detail');
    const notif = await createResp.json();

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const getResp = await ctx.get(`/notifications/${notif.id}`, { headers });
    expect(getResp.status()).toBe(200);
    const body = await getResp.json();
    expect(body.id).toBe(notif.id);
    expect(body.title).toBe('Detail');
  });

  test('E2E-NOTIF-020: user A list does not include user B notifications', async () => {
    await createNotification(BASE_URL, TEST_USER_A, 'system', 'A Note', 'C');
    await createNotification(BASE_URL, TEST_USER_B, 'system', 'B Note', 'C');

    const respA = await listNotifications(BASE_URL, TEST_USER_A);
    const bodyA = await respA.json();
    expect(bodyA.items.every((i: any) => i.userId === TEST_USER_A)).toBe(true);
    expect(bodyA.items.some((i: any) => i.title === 'B Note')).toBe(false);
  });
});
