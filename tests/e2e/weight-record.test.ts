import { test, expect, request } from '@playwright/test';
import { generateAuthHeaders, TEST_USER_A, TEST_USER_B } from './auth';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

function getToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function createWeightRecord(
  baseURL: string,
  userId: string,
  date: string,
  period: 'morning' | 'evening',
  weight: number,
  note?: string
) {
  const ctx = await request.newContext({ baseURL });
  const headers = generateAuthHeaders(userId);
  const body: Record<string, unknown> = { date, period, weight };
  if (note) body.note = note;
  return ctx.post('/weight-records', { headers, data: body });
}

async function listWeightRecords(
  baseURL: string,
  userId: string,
  params?: Record<string, string>
) {
  const ctx = await request.newContext({ baseURL });
  const headers = generateAuthHeaders(userId);
  return ctx.get('/weight-records', { headers, params });
}

test.describe('Weight Record E2E', () => {
  test.beforeEach(async () => {
    // Clean up test user records before each test
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const resp = await ctx.get('/weight-records', {
      headers,
      params: { pageSize: '100' },
    });
    const body = await resp.json();
    for (const item of body.items || []) {
      await ctx.delete(`/weight-records/${item.id}`, { headers });
    }
  });

  test('E2E-WEIGHT-001: morning weight record creation', async () => {
    const today = getToday();
    const resp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.5, '空腹');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.userId).toBe(TEST_USER_A);
    expect(body.date).toBe(today);
    expect(body.period).toBe('morning');
    expect(body.weight).toBe(70.5);
    expect(body.note).toBe('空腹');
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
    expect(body.updatedAt).toBeDefined();
  });

  test('E2E-WEIGHT-002: evening weight record creation', async () => {
    const today = getToday();
    const resp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'evening', 71.2, '晚饭后');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.period).toBe('evening');
    expect(body.weight).toBe(71.2);
  });

  test('E2E-WEIGHT-003: morning and evening same day - weight diff calculated', async () => {
    const today = getToday();
    // Create morning
    const respM = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.0);
    expect(respM.status()).toBe(200);
    // Create evening
    const respE = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'evening', 71.0);
    expect(respE.status()).toBe(200);

    // Query list - both should have weightDiff
    const listResp = await listWeightRecords(BASE_URL, TEST_USER_A, { startDate: today, endDate: today });
    expect(listResp.status()).toBe(200);
    const listBody = await listResp.json();
    expect(listBody.items.length).toBe(2);

    const withDiff = listBody.items.find((i: any) => i.weightDiff !== undefined);
    expect(withDiff.weightDiff).toBe(1.0); // 71.0 - 70.0
  });

  test('E2E-WEIGHT-004: update existing weight record (same period same day)', async () => {
    const today = getToday();
    // Create first
    const resp1 = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.0);
    expect(resp1.status()).toBe(200);
    const original = await resp1.json();
    const originalUpdatedAt = original.updatedAt;

    // Wait a bit to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));

    // Update same period
    const resp2 = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 69.5, '更新备注');
    expect(resp2.status()).toBe(200);
    const updated = await resp2.json();
    expect(updated.id).toBe(original.id);
    expect(updated.weight).toBe(69.5);
    expect(updated.note).toBe('更新备注');
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
  });

  test('E2E-WEIGHT-005: weight validation - below minimum (15kg)', async () => {
    const today = getToday();
    const resp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 15.0);
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/20.*300/);
  });

  test('E2E-WEIGHT-006: weight validation - above maximum (350kg)', async () => {
    const today = getToday();
    const resp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 350.0);
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.success).toBe(false);
  });

  test('E2E-WEIGHT-007: weight validation - NaN rejected', async () => {
    const today = getToday();
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const resp = await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'morning', weight: NaN },
    });
    expect(resp.status()).toBe(400);
  });

  test('E2E-WEIGHT-008: date cannot be in the future', async () => {
    const future = '2099-12-31';
    const resp = await createWeightRecord(BASE_URL, TEST_USER_A, future, 'morning', 70.0);
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('不能超过当前日期');
  });

  test('E2E-WEIGHT-009: invalid date format rejected', async () => {
    const resp = await createWeightRecord(BASE_URL, TEST_USER_A, '2026-13-01', 'morning', 70.0);
    expect(resp.status()).toBe(400);
  });

  test('E2E-WEIGHT-010: invalid period rejected', async () => {
    const today = getToday();
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const resp = await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'afternoon', weight: 70.0 },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('morning');
  });

  test('E2E-WEIGHT-011: note with HTML tags rejected', async () => {
    const today = getToday();
    const resp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.0, '<script>alert(1)</script>');
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('非法内容');
  });

  test('E2E-WEIGHT-012: note with event handler rejected', async () => {
    const today = getToday();
    const resp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.0, 'onclick=evil()');
    expect(resp.status()).toBe(400);
  });

  test('E2E-WEIGHT-013: pagination works correctly', async () => {
    const today = getToday();
    const yesterday = getYesterday();
    // Create records for 3 days
    await createWeightRecord(BASE_URL, TEST_USER_A, yesterday, 'morning', 70.0);
    await createWeightRecord(BASE_URL, TEST_USER_A, yesterday, 'evening', 71.0);
    await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 69.5);

    const resp = await listWeightRecords(BASE_URL, TEST_USER_A, { page: '1', pageSize: '2' });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.items.length).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(body.total).toBe(3);
  });

  test('E2E-WEIGHT-014: filter by period', async () => {
    const today = getToday();
    const yesterday = getYesterday();
    await createWeightRecord(BASE_URL, TEST_USER_A, yesterday, 'morning', 70.0);
    await createWeightRecord(BASE_URL, TEST_USER_A, yesterday, 'evening', 71.0);
    await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 69.5);

    const resp = await listWeightRecords(BASE_URL, TEST_USER_A, { period: 'morning' });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.items.length).toBe(2);
    for (const item of body.items) {
      expect(item.period).toBe('morning');
    }
  });

  test('E2E-WEIGHT-015: date range filter', async () => {
    const today = getToday();
    const yesterday = getYesterday();
    await createWeightRecord(BASE_URL, TEST_USER_A, yesterday, 'morning', 70.0);
    await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 69.5);

    const resp = await listWeightRecords(BASE_URL, TEST_USER_A, { startDate: yesterday, endDate: yesterday });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.total).toBe(1);
    expect(body.items[0].date).toBe(yesterday);
  });

  test('E2E-WEIGHT-016: get single weight record by ID', async () => {
    const today = getToday();
    const createResp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.0);
    const record = await createResp.json();

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const getResp = await ctx.get(`/weight-records/${record.id}`, { headers });
    expect(getResp.status()).toBe(200);
    const body = await getResp.json();
    expect(body.id).toBe(record.id);
    expect(body.weight).toBe(70.0);
  });

  test('E2E-WEIGHT-017: delete weight record', async () => {
    const today = getToday();
    const createResp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.0);
    const record = await createResp.json();

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const delResp = await ctx.delete(`/weight-records/${record.id}`, { headers });
    expect(delResp.status()).toBe(200);
    const delBody = await delResp.json();
    expect(delBody.success).toBe(true);

    // Verify deleted
    const getResp = await ctx.get(`/weight-records/${record.id}`, { headers });
    expect(getResp.status()).toBe(404);
  });

  test('E2E-WEIGHT-018: get weight stats', async () => {
    const today = getToday();
    const yesterday = getYesterday();
    await createWeightRecord(BASE_URL, TEST_USER_A, yesterday, 'morning', 70.0);
    await createWeightRecord(BASE_URL, TEST_USER_A, yesterday, 'evening', 71.0);
    await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 69.5);

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const resp = await ctx.get('/weight-records/stats', { headers });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.avgMorningWeight).toBe(69.8); // (70 + 69.5) / 2
    expect(body.avgEveningWeight).toBe(71.0);
    expect(body.minWeight).toBe(69.5);
    expect(body.maxWeight).toBe(71.0);
    expect(body.change).toBe(-0.5); // 69.5 - 70.0 (first record was yesterday morning 70.0)
    expect(body.avgWeightDiff).toBe(1.0); // only yesterday has both
  });

  test('E2E-WEIGHT-019: cross-user data isolation - user B cannot read user A records', async () => {
    const today = getToday();
    const createResp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.0);
    const record = await createResp.json();

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headersB = generateAuthHeaders(TEST_USER_B);
    const getResp = await ctx.get(`/weight-records/${record.id}`, { headers: headersB });
    expect(getResp.status()).toBe(404);
  });

  test('E2E-WEIGHT-020: cross-user data isolation - user B cannot delete user A records', async () => {
    const today = getToday();
    const createResp = await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.0);
    const record = await createResp.json();

    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headersB = generateAuthHeaders(TEST_USER_B);
    const delResp = await ctx.delete(`/weight-records/${record.id}`, { headers: headersB });
    expect(delResp.status()).toBe(404);

    // Verify still exists for user A
    const headersA = generateAuthHeaders(TEST_USER_A);
    const getResp = await ctx.get(`/weight-records/${record.id}`, { headers: headersA });
    expect(getResp.status()).toBe(200);
  });

  test('E2E-WEIGHT-021: user A cannot see user B records in list', async () => {
    const today = getToday();
    await createWeightRecord(BASE_URL, TEST_USER_A, today, 'morning', 70.0);
    await createWeightRecord(BASE_URL, TEST_USER_B, today, 'morning', 80.0);

    const respA = await listWeightRecords(BASE_URL, TEST_USER_A);
    const bodyA = await respA.json();
    const allA = bodyA.items.every((i: any) => i.weight === 70.0 || i.period !== 'evening' || true);
    expect(bodyA.items.every((i: any) => i.userId === TEST_USER_A)).toBe(true);

    const respB = await listWeightRecords(BASE_URL, TEST_USER_B);
    const bodyB = await respB.json();
    expect(bodyB.items.every((i: any) => i.userId === TEST_USER_B)).toBe(true);
  });

  test('E2E-WEIGHT-022: empty weight records returns empty list', async () => {
    const resp = await listWeightRecords(BASE_URL, 'brand-new-user-xyz');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  test('E2E-WEIGHT-023: stats on empty data returns nulls', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders('brand-new-user-xyz');
    const resp = await ctx.get('/weight-records/stats', { headers });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.avgMorningWeight).toBeNull();
    expect(body.minWeight).toBeNull();
  });
});
