import { test, expect, request } from '@playwright/test';
import { generateAuthHeaders, TEST_USER_A, TEST_USER_B } from './auth';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

test.describe('Reminder E2E Tests', () => {
  const uniqueSuffix = Date.now().toString();
  const userA = `${TEST_USER_A}-rem-${uniqueSuffix}`;
  const userB = `${TEST_USER_B}-rem-${uniqueSuffix}`;
  let createdReminderId: string;

  test.describe('Create Reminder', () => {
    test('E2E-REM-001: creates a morning reminder', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/reminders`, {
        headers,
        data: { remindTime: '07:00', period: 'morning', enabled: true },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.id).toBeDefined();
      expect(body.userId).toBe(userA);
      expect(body.remindTime).toBe('07:00');
      expect(body.period).toBe('morning');
      expect(body.enabled).toBe(true);
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();

      createdReminderId = body.id;
    });

    test('E2E-REM-002: creates an evening reminder', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/reminders`, {
        headers,
        data: { remindTime: '21:00', period: 'evening', enabled: true },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.period).toBe('evening');
      expect(body.remindTime).toBe('21:00');
    });

    test('E2E-REM-003: creates a both-period reminder', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/reminders`, {
        headers,
        data: { remindTime: '08:00', period: 'both', enabled: false },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.period).toBe('both');
      expect(body.enabled).toBe(false);
    });

    test('E2E-REM-004: rejects invalid remindTime format', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/reminders`, {
        headers,
        data: { remindTime: '25:00', period: 'morning' },
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('HH:MM');
    });

    test('E2E-REM-005: rejects invalid remindTime with wrong separator', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/reminders`, {
        headers,
        data: { remindTime: '7-00', period: 'morning' },
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    test('E2E-REM-006: rejects invalid period', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/reminders`, {
        headers,
        data: { remindTime: '07:00', period: 'afternoon' },
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('morning、evening 或 both');
    });

    test('E2E-REM-007: rejects empty remindTime', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/reminders`, {
        headers,
        data: { remindTime: '', period: 'morning' },
      });
      expect(response.status()).toBe(400);
    });

    test('E2E-REM-008: enabled defaults to true when not provided', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/reminders`, {
        headers,
        data: { remindTime: '12:00', period: 'morning' },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.enabled).toBe(true);
    });
  });

  test.describe('List Reminders', () => {
    test('E2E-REM-009: lists reminders sorted by time', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.get(`${BASE_URL}/reminders`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(4);

      // Verify sorted by remindTime ascending
      const times = body.data.map((r: any) => r.remindTime);
      expect(times).toEqual([...times].sort());
    });

    test('E2E-REM-010: returns empty list for user with no reminders', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const freshUser = `fresh-user-rem-${uniqueSuffix}`;
      const headers = generateAuthHeaders(freshUser);

      const response = await ctx.get(`${BASE_URL}/reminders`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });

  test.describe('Update Reminder', () => {
    test('E2E-REM-011: updates remindTime', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.put(`${BASE_URL}/reminders/${createdReminderId}`, {
        headers,
        data: { remindTime: '06:30' },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.remindTime).toBe('06:30');
      expect(body.period).toBe('morning'); // unchanged
      expect(body.enabled).toBe(true); // unchanged
    });

    test('E2E-REM-012: updates period', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.put(`${BASE_URL}/reminders/${createdReminderId}`, {
        headers,
        data: { period: 'both' },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.period).toBe('both');
    });

    test('E2E-REM-013: toggles enabled to false', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.put(`${BASE_URL}/reminders/${createdReminderId}`, {
        headers,
        data: { enabled: false },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.enabled).toBe(false);
    });

    test('E2E-REM-014: toggles enabled back to true', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.put(`${BASE_URL}/reminders/${createdReminderId}`, {
        headers,
        data: { enabled: true },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.enabled).toBe(true);
    });

    test('E2E-REM-015: returns 404 for non-existent reminder', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.put(`${BASE_URL}/reminders/non-existent-id`, {
        headers,
        data: { enabled: false },
      });
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    test('E2E-REM-016: rejects invalid period on update', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.put(`${BASE_URL}/reminders/${createdReminderId}`, {
        headers,
        data: { period: 'noon' },
      });
      expect(response.status()).toBe(400);
    });
  });

  test.describe('Delete Reminder', () => {
    test('E2E-REM-017: deletes a reminder', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      // Create a temp reminder to delete
      const createResp = await ctx.post(`${BASE_URL}/reminders`, {
        headers,
        data: { remindTime: '23:00', period: 'evening' },
      });
      const created = await createResp.json();

      const deleteResp = await ctx.delete(`${BASE_URL}/reminders/${created.id}`, { headers });
      expect(deleteResp.status()).toBe(200);
      const deleteBody = await deleteResp.json();
      expect(deleteBody.success).toBe(true);

      // Verify it's gone from the list
      const listResp = await ctx.get(`${BASE_URL}/reminders`, { headers });
      const listBody = await listResp.json();
      const ids = listBody.data.map((r: any) => r.id);
      expect(ids).not.toContain(created.id);
    });

    test('E2E-REM-018: returns 404 when deleting non-existent reminder', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.delete(`${BASE_URL}/reminders/non-existent-id`, { headers });
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
    });
  });

  test.describe('User Isolation', () => {
    test('E2E-REM-019: user B cannot update user A reminder', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headersB = generateAuthHeaders(userB);

      const response = await ctx.put(`${BASE_URL}/reminders/${createdReminderId}`, {
        headers: headersB,
        data: { enabled: false },
      });
      expect(response.status()).toBe(404);
    });

    test('E2E-REM-020: user B cannot delete user A reminder', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headersB = generateAuthHeaders(userB);

      const response = await ctx.delete(`${BASE_URL}/reminders/${createdReminderId}`, { headers: headersB });
      expect(response.status()).toBe(404);
    });

    test('E2E-REM-021: user B list does not include user A reminders', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });

      // Create a reminder for user B
      const headersB = generateAuthHeaders(userB);
      await ctx.post(`${BASE_URL}/reminders`, {
        headers: headersB,
        data: { remindTime: '10:00', period: 'morning' },
      });

      // Verify user A list doesn't include user B's
      const headersA = generateAuthHeaders(userA);
      const resp = await ctx.get(`${BASE_URL}/reminders`, { headers: headersA });
      const body = await resp.json();
      for (const r of body.data) {
        expect(r.userId).toBe(userA);
      }
    });
  });
});
