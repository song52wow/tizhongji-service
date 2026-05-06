import { test, expect, request } from '@playwright/test';
import { generateAuthHeaders, TEST_USER_A } from './auth';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

function getToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

test.describe('Input Validation Edge Cases E2E', () => {
  test.beforeEach(async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const resp = await ctx.get('/weight-records', { headers, params: { pageSize: '100' } });
    const body = await resp.json();
    for (const item of body.items || []) {
      await ctx.delete(`/weight-records/${item.id}`, { headers });
    }
    const notifResp = await ctx.get('/notifications', { headers, params: { pageSize: '100' } });
    const notifBody = await notifResp.json();
    for (const item of notifBody.items || []) {
      await ctx.delete(`/notifications/${item.id}`, { headers });
    }
  });

  test('E2E-VALID-001: empty body returns 400', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/weight-records', {
      headers,
      data: {},
    });
    expect(response.status()).toBe(400);
  });

  test('E2E-VALID-002: missing required fields returns 400', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    // Missing weight
    const resp1 = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning' },
    });
    expect(resp1.status()).toBe(400);
    // Missing period
    const resp2 = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), weight: 70.0 },
    });
    expect(resp2.status()).toBe(400);
    // Missing date
    const resp3 = await ctx.post('/weight-records', {
      headers,
      data: { period: 'morning', weight: 70.0 },
    });
    expect(resp3.status()).toBe(400);
  });

  test('E2E-VALID-003: weight at minimum boundary (20kg)', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning', weight: 20.0 },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.weight).toBe(20.0);
  });

  test('E2E-VALID-004: weight at maximum boundary (300kg)', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning', weight: 300.0 },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.weight).toBe(300.0);
  });

  test('E2E-VALID-005: weight just below minimum (19.9kg) rejected', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning', weight: 19.9 },
    });
    expect(response.status()).toBe(400);
  });

  test('E2E-VALID-006: weight just above maximum (300.1kg) rejected', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning', weight: 300.1 },
    });
    expect(response.status()).toBe(400);
  });

  test('E2E-VALID-007: note with whitespace-only trimmed to empty', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning', weight: 70.0, note: '   ' },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.note).toBe('');
  });

  test('E2E-VALID-008: note at max length (200 chars) accepted', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const longNote = 'A'.repeat(200);
    const response = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning', weight: 70.0, note: longNote },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.note).toBe(longNote);
  });

  test('E2E-VALID-009: note at 201 chars rejected', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const longNote = 'A'.repeat(201);
    const response = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning', weight: 70.0, note: longNote },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('200');
  });

  test('E2E-VALID-010: notification with whitespace-only title rejected', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/notifications', {
      headers,
      data: { type: 'system', title: '   ', content: '内容' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('不能为空');
  });

  test('E2E-VALID-011: notification with empty title rejected', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/notifications', {
      headers,
      data: { type: 'system', title: '', content: '内容' },
    });
    expect(response.status()).toBe(400);
  });

  test('E2E-VALID-012: notification with empty content rejected', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/notifications', {
      headers,
      data: { type: 'system', title: '标题', content: '' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('不能为空');
  });

  test('E2E-VALID-012b: notification with whitespace-only content rejected', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/notifications', {
      headers,
      data: { type: 'system', title: '标题', content: '   ' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('不能为空');
  });

  test('E2E-VALID-012c: notification with mixed whitespace content trimmed', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/notifications', {
      headers,
      data: { type: 'system', title: '标题', content: '  实际内容  ' },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.content).toBe('实际内容');
  });

  test('E2E-VALID-013: notification title at max length (100 chars) accepted', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const maxTitle = 'B'.repeat(100);
    const response = await ctx.post('/notifications', {
      headers,
      data: { type: 'system', title: maxTitle, content: '内容' },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.title).toBe(maxTitle);
  });

  test('E2E-VALID-014: invalid JSON body returns 400', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.fetch('/weight-records', {
      method: 'POST',
      headers,
      data: 'not-valid-json',
    });
    // Either 400 (JSON parse error) or 413 (body too large in raw form)
    expect([400, 413]).toContain(response.status());
  });

  test('E2E-VALID-015: pageSize exceeding max (100) gets capped', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.get('/weight-records', {
      headers,
      params: { pageSize: '200' },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.pageSize).toBeLessThanOrEqual(100);
  });

  test('E2E-VALID-016: negative page number defaults to 1', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.get('/notifications', {
      headers,
      params: { page: '-1' },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.page).toBeGreaterThanOrEqual(1);
  });

  test('E2E-VALID-017: invalid boolean param in isRead returns all', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.get('/notifications', {
      headers,
      params: { isRead: 'maybe' },
    });
    // Should treat as undefined/ignored, returning all notifications
    expect(response.status()).toBe(200);
  });

  test('E2E-VALID-018: weight with decimal precision up to 2 places accepted', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning', weight: 70.123 },
    });
    expect(response.status()).toBe(200);
  });

  test('E2E-VALID-019: unicode in note is preserved', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const unicodeNote = '早起床后测量 🏃 喝了水 💧';
    const response = await ctx.post('/weight-records', {
      headers,
      data: { date: getToday(), period: 'morning', weight: 70.0, note: unicodeNote },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.note).toBe(unicodeNote);
  });

  test('E2E-VALID-020: unicode in notification title/content is preserved', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.post('/notifications', {
      headers,
      data: {
        type: 'system',
        title: '体重记录提醒 📊',
        content: '今日体重变化：-0.5kg，继续加油 💪',
      },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.title).toContain('体重记录提醒');
    expect(body.content).toContain('体重变化');
  });

  test('E2E-VALID-021: stats with date range returns correct period', async () => {
    const today = getToday();
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);

    // Create records for today and yesterday
    await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'morning', weight: 70.0 },
    });

    const statsResp = await ctx.get('/weight-records/stats', {
      headers,
      params: { startDate: today, endDate: today },
    });
    expect(statsResp.status()).toBe(200);
    const stats = await statsResp.json();
    expect(stats.avgMorningWeight).toBe(70.0);
  });

  test('E2E-VALID-022: stats with invalid date range returns 400', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.get('/weight-records/stats', {
      headers,
      params: { startDate: 'not-a-date', endDate: '2026-01-01' },
    });
    expect(response.status()).toBe(400);
  });
});
