import { test, expect, request } from '@playwright/test';
import { generateAuthHeaders, TEST_USER_A, TEST_USER_B } from './auth';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getToday(): string {
  return formatDate(new Date());
}

function getDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

test.describe('Achievement E2E Tests', () => {
  const uniqueSuffix = Date.now().toString();
  const userA = `${TEST_USER_A}-ach-${uniqueSuffix}`;
  const userB = `${TEST_USER_B}-ach-${uniqueSuffix}`;
  const today = getToday();

  test.describe('Record Activity', () => {
    test('E2E-ACH-001: records a login activity', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'login', date: today },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.id).toBeDefined();
      expect(body.userId).toBe(userA);
      expect(body.activityType).toBe('login');
      expect(body.date).toBe(today);
      expect(body.createdAt).toBeDefined();
    });

    test('E2E-ACH-002: records a record_weight activity', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'record_weight', date: today },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.activityType).toBe('record_weight');
    });

    test('E2E-ACH-003: records a check_in activity', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'check_in', date: today },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.activityType).toBe('check_in');
    });

    test('E2E-ACH-004: records activity with metadata', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'check_in', date: getDaysAgo(1), metadata: '{"source":"manual"}' },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.metadata).toBe('{"source":"manual"}');
    });

    test('E2E-ACH-005: duplicate activity for same day returns existing (no error)', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const resp1 = await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'login', date: today },
      });
      const body1 = await resp1.json();

      const resp2 = await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'login', date: today },
      });
      const body2 = await resp2.json();

      expect(resp2.status()).toBe(200);
      expect(body2.id).toBe(body1.id); // Same record returned
    });

    test('E2E-ACH-006: rejects invalid activityType', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'invalid_type', date: today },
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('login、record_weight 或 check_in');
    });

    test('E2E-ACH-007: rejects invalid date format', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'login', date: '2026/01/01' },
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('YYYY-MM-DD');
    });

    test('E2E-ACH-008: rejects empty activity type', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: '', date: today },
      });
      expect(response.status()).toBe(400);
    });
  });

  test.describe('Achievement Stats', () => {
    test('E2E-ACH-009: returns stats with zero values for new user', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const freshUser = `fresh-user-ach-${uniqueSuffix}`;
      const headers = generateAuthHeaders(freshUser);

      const response = await ctx.get(`${BASE_URL}/achievements/stats`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.totalLoginDays).toBe(0);
      expect(body.data.totalRecords).toBe(0);
      expect(body.data.consecutiveRecordDays).toBe(0);
      expect(body.data.currentStreak).toBe(0);
      expect(body.data.longestStreak).toBe(0);
    });

    test('E2E-ACH-010: tracks total login days', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const tracker = `tracker-ach-${uniqueSuffix}`;
      const headers = generateAuthHeaders(tracker);

      // Record login for 3 different days
      await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'login', date: getDaysAgo(2) },
      });
      await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'login', date: getDaysAgo(1) },
      });
      await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers,
        data: { activityType: 'login', date: today },
      });

      const response = await ctx.get(`${BASE_URL}/achievements/stats`, { headers });
      const body = await response.json();
      expect(body.data.totalLoginDays).toBe(3);
    });

    test('E2E-ACH-011: tracks consecutive record days', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const tracker = `tracker2-ach-${uniqueSuffix}`;
      const headers = generateAuthHeaders(tracker);

      // Create weight records across multiple consecutive days
      for (let i = 3; i >= 0; i--) {
        const date = getDaysAgo(i);
        await ctx.post(`${BASE_URL}/weight-records`, {
          headers,
          data: { date, period: 'morning', weight: 65.0 },
        });
      }

      const response = await ctx.get(`${BASE_URL}/achievements/stats`, { headers });
      const body = await response.json();
      expect(body.data.consecutiveRecordDays).toBe(4);
      expect(body.data.totalRecords).toBe(4);
    });

    test('E2E-ACH-012: calculates current streak from weight records', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const tracker = `tracker3-ach-${uniqueSuffix}`;
      const headers = generateAuthHeaders(tracker);

      // Consecutive weight records for last 5 days
      for (let i = 4; i >= 0; i--) {
        const date = getDaysAgo(i);
        await ctx.post(`${BASE_URL}/weight-records`, {
          headers,
          data: { date, period: 'morning', weight: 65.0 },
        });
      }

      const response = await ctx.get(`${BASE_URL}/achievements/stats`, { headers });
      const body = await response.json();
      expect(body.data.currentStreak).toBeGreaterThanOrEqual(5);
      expect(body.data.longestStreak).toBeGreaterThanOrEqual(5);
    });

    test('E2E-ACH-013: stats are per-user isolated', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const isoA = `iso-a-ach-${uniqueSuffix}`;
      const isoB = `iso-b-ach-${uniqueSuffix}`;

      // User A records activity
      const headersA = generateAuthHeaders(isoA);
      await ctx.post(`${BASE_URL}/achievements/activity`, {
        headers: headersA,
        data: { activityType: 'login', date: today },
      });

      // User B's stats should not reflect user A's activity
      const headersB = generateAuthHeaders(isoB);
      const response = await ctx.get(`${BASE_URL}/achievements/stats`, { headers: headersB });
      const body = await response.json();
      expect(body.data.totalLoginDays).toBe(0);
    });
  });
});
