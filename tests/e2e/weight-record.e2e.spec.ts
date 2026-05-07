import { test, expect, request } from '@playwright/test';
import crypto from 'crypto';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-change-in-production';

function createAuthHeaders(userId: string): Record<string, string> {
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(userId).digest('hex');
  return {
    'X-User-Id': userId,
    'X-User-Signature': signature,
    'Content-Type': 'application/json',
  };
}

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
  ctx: any,
  userId: string,
  date: string,
  period: 'morning' | 'evening',
  weight: number,
  note?: string
) {
  const headers = createAuthHeaders(userId);
  const body: Record<string, any> = { date, period, weight };
  if (note) body.note = note;

  return ctx.post(`${BASE_URL}/weight-records`, { headers, data: body });
}

test.describe('Weight Record E2E Tests', () => {
  const testUserId = 'test-user-e2e-' + Date.now();
  let testRecordId: string;

  test.describe('Authentication', () => {
    test('health endpoint works without auth', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const response = await ctx.get('/health');
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('ok');
    });

    test('rejects requests without auth headers', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const response = await ctx.get('/weight-records');
      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('未认证');
    });

    test('rejects requests with invalid X-User-Id format', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = {
        'X-User-Id': 'invalid user id with spaces',
        'X-User-Signature': 'abc123',
        'Content-Type': 'application/json',
      };
      const response = await ctx.get('/weight-records', { headers });
      expect(response.status()).toBe(401);
    });

    test('rejects requests with invalid signature', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = {
        'X-User-Id': testUserId,
        'X-User-Signature': 'a'.repeat(64), // invalid signature
        'Content-Type': 'application/json',
      };
      const response = await ctx.get('/weight-records', { headers });
      expect(response.status()).toBe(401);
    });

    test('accepts valid auth headers', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const response = await ctx.get('/weight-records', { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.items).toBeDefined();
      expect(body.total).toBeDefined();
    });
  });

  test.describe('CRUD Operations', () => {
    test('creates a new weight record', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      const response = await createWeightRecord(ctx, testUserId, today, 'morning', 65.5, 'morning weight');
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.userId).toBe(testUserId);
      expect(body.date).toBe(today);
      expect(body.period).toBe('morning');
      expect(body.weight).toBe(65.5);
      expect(body.note).toBe('morning weight');
      expect(body.id).toBeDefined();
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();

      testRecordId = body.id;
    });

    test('upserts (updates) existing record for same date and period', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      // Create initial record
      await createWeightRecord(ctx, testUserId, today, 'morning', 65.5);

      // Update same record
      const response = await createWeightRecord(ctx, testUserId, today, 'morning', 64.8, 'updated');
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.weight).toBe(64.8);
      expect(body.note).toBe('updated');
      expect(body.id).toBeDefined();
    });

    test('rejects weight out of range', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      const response = await createWeightRecord(ctx, testUserId, today, 'morning', 500);
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('20~300');
    });

    test('rejects future date', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const futureDate = '2099-01-01';

      const response = await createWeightRecord(ctx, testUserId, futureDate, 'morning', 65.0);
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('超过当前日期');
    });

    test('rejects invalid date format', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);

      const response = await createWeightRecord(ctx, testUserId, '2024-1-1', 'morning', 65.0);
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    test('rejects invalid period', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      const response = await ctx.post(`${BASE_URL}/weight-records`, {
        headers,
        data: { date: today, period: 'afternoon', weight: 65.0 },
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('morning 或 evening');
    });

    test('rejects note with HTML tags', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      const response = await createWeightRecord(ctx, testUserId, today, 'morning', 65.0, '<script>alert(1)</script>');
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('非法内容');
    });

    test('gets weight record by ID', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      // Create a record first
      const createResp = await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
      const created = await createResp.json();

      // Get by ID
      const response = await ctx.get(`${BASE_URL}/weight-records/${created.id}`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(created.id);
      expect(body.weight).toBe(65.0);
    });

    test('returns 404 for non-existent record ID', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);

      const response = await ctx.get(`${BASE_URL}/weight-records/non-existent-id`, { headers });
      expect(response.status()).toBe(404);
    });

    test('deletes weight record by ID', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      // Create a record
      const createResp = await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
      const created = await createResp.json();

      // Delete it
      const deleteResp = await ctx.delete(`${BASE_URL}/weight-records/${created.id}`, { headers });
      expect(deleteResp.status()).toBe(200);
      const deleteBody = await deleteResp.json();
      expect(deleteBody.success).toBe(true);

      // Verify it's gone
      const getResp = await ctx.get(`${BASE_URL}/weight-records/${created.id}`, { headers });
      expect(getResp.status()).toBe(404);
    });

    test('returns 404 when deleting non-existent record', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);

      const response = await ctx.delete(`${BASE_URL}/weight-records/non-existent-id`, { headers });
      expect(response.status()).toBe(404);
    });
  });

  test.describe('Morning/Evening Split', () => {
    test('creates separate morning and evening records for same day', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      const morningResp = await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
      const eveningResp = await createWeightRecord(ctx, testUserId, today, 'evening', 66.5);

      expect(morningResp.status()).toBe(200);
      expect(eveningResp.status()).toBe(200);

      const morning = await morningResp.json();
      const evening = await eveningResp.json();

      expect(morning.period).toBe('morning');
      expect(evening.period).toBe('evening');
      expect(morning.weight).toBe(65.0);
      expect(evening.weight).toBe(66.5);
    });

    test('lists all records with morning and evening', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
      await createWeightRecord(ctx, testUserId, today, 'evening', 66.5);

      const response = await ctx.get(`${BASE_URL}/weight-records`, { headers });
      const body = await response.json();

      expect(body.items.length).toBeGreaterThanOrEqual(2);
      const todayItems = body.items.filter((item: any) => item.date === today);
      expect(todayItems.length).toBe(2);
    });

    test('filters records by morning period', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
      await createWeightRecord(ctx, testUserId, today, 'evening', 66.5);

      const response = await ctx.get(`${BASE_URL}/weight-records?period=morning`, { headers });
      const body = await response.json();

      expect(body.items.every((item: any) => item.period === 'morning')).toBe(true);
    });

    test('filters records by evening period', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
      await createWeightRecord(ctx, testUserId, today, 'evening', 66.5);

      const response = await ctx.get(`${BASE_URL}/weight-records?period=evening`, { headers });
      const body = await response.json();

      expect(body.items.every((item: any) => item.period === 'evening')).toBe(true);
    });

    test('calculates weight diff when both morning and evening exist', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();

      await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
      await createWeightRecord(ctx, testUserId, today, 'evening', 66.5);

      const response = await ctx.get(`${BASE_URL}/weight-records`, { headers });
      const body = await response.json();

      const todayItems = body.items.filter((item: any) => item.date === today);
      const morning = todayItems.find((item: any) => item.period === 'morning');
      const evening = todayItems.find((item: any) => item.period === 'evening');

      expect(morning.weightDiff).toBeCloseTo(1.5, 1);
      expect(evening.weightDiff).toBeCloseTo(1.5, 1);
    });
  });

  test.describe('Statistics Endpoint', () => {
    test('calculates stats for weight records', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();
      const yesterday = getYesterday();

      await createWeightRecord(ctx, testUserId, yesterday, 'morning', 65.0);
      await createWeightRecord(ctx, testUserId, yesterday, 'evening', 66.0);
      await createWeightRecord(ctx, testUserId, today, 'morning', 64.5);
      await createWeightRecord(ctx, testUserId, today, 'evening', 65.8);

      const response = await ctx.get(`${BASE_URL}/weight-records/stats`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.avgMorningWeight).toBeDefined();
      expect(body.avgEveningWeight).toBeDefined();
      expect(body.minWeight).toBeDefined();
      expect(body.maxWeight).toBeDefined();
      expect(body.change).toBeDefined();
      expect(body.avgWeightDiff).toBeDefined();
    });

    test('stats returns null for avg fields when no records', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders('user-with-no-records-' + Date.now());

      const response = await ctx.get(`${BASE_URL}/weight-records/stats`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.avgMorningWeight).toBeNull();
      expect(body.avgEveningWeight).toBeNull();
      expect(body.minWeight).toBeNull();
      expect(body.maxWeight).toBeNull();
      expect(body.change).toBeNull();
      expect(body.avgWeightDiff).toBeNull();
    });

    test('stats respects date range filter', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();
      const yesterday = getYesterday();

      await createWeightRecord(ctx, testUserId, yesterday, 'morning', 70.0);
      await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);

      const response = await ctx.get(
        `${BASE_URL}/weight-records/stats?startDate=${yesterday}&endDate=${yesterday}`,
        { headers }
      );
      const body = await response.json();

      // Should only include yesterday's weight
      expect(body.minWeight).toBe(70.0);
      expect(body.maxWeight).toBe(70.0);
    });
  });

  test.describe('Pagination and Listing', () => {
    test('lists weight records with pagination', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);

      const response = await ctx.get(`${BASE_URL}/weight-records?page=1&pageSize=10`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.items).toBeDefined();
      expect(body.total).toBeDefined();
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(10);
    });

    test('lists weight records sorted by date ascending', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();
      const yesterday = getYesterday();

      await createWeightRecord(ctx, testUserId, yesterday, 'morning', 65.0);
      await createWeightRecord(ctx, testUserId, today, 'morning', 66.0);

      const response = await ctx.get(`${BASE_URL}/weight-records`, { headers });
      const body = await response.json();

      // Should be sorted by date ascending
      const dates = body.items.map((item: any) => item.date);
      expect(dates).toEqual([...dates].sort());
    });

    test('filters records by date range', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = createAuthHeaders(testUserId);
      const today = getToday();
      const yesterday = getYesterday();

      await createWeightRecord(ctx, testUserId, yesterday, 'morning', 65.0);
      await createWeightRecord(ctx, testUserId, today, 'morning', 66.0);

      const response = await ctx.get(
        `${BASE_URL}/weight-records?startDate=${yesterday}&endDate=${yesterday}`,
        { headers }
      );
      const body = await response.json();

      expect(body.items.every((item: any) => item.date === yesterday)).toBe(true);
    });
  });

  test.describe('Auth Header Variations', () => {
    test('requires both X-User-Id and X-User-Signature', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });

      // Only X-User-Id
      const resp1 = await ctx.get('/weight-records', {
        headers: { 'X-User-Id': testUserId, 'Content-Type': 'application/json' },
      });
      expect(resp1.status()).toBe(401);

      // Only X-User-Signature
      const resp2 = await ctx.get('/weight-records', {
        headers: { 'X-User-Signature': 'abc123', 'Content-Type': 'application/json' },
      });
      expect(resp2.status()).toBe(401);
    });

    test('user isolation - different users cannot see each others records', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const user1 = testUserId + '-isolate-1';
      const user2 = testUserId + '-isolate-2';
      const today = getToday();

      // User 1 creates a record
      await createWeightRecord(ctx, user1, today, 'morning', 65.0, 'user1 record');

      // User 2 queries - should get empty or different records
      const headers2 = createAuthHeaders(user2);
      const response = await ctx.get(`${BASE_URL}/weight-records`, { headers: headers2 });
      const body = await response.json();

      const user1Records = body.items.filter((item: any) => item.note === 'user1 record');
      expect(user1Records.length).toBe(0);
    });
  });
});