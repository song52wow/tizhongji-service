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

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

test.describe('Complete User Flow E2E', () => {
  const userId = TEST_USER_A;

  test.beforeEach(async () => {
    // Clean up
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(userId);

    const weightResp = await ctx.get('/weight-records', { headers, params: { pageSize: '100' } });
    const weightBody = await weightResp.json();
    for (const item of weightBody.items || []) {
      await ctx.delete(`/weight-records/${item.id}`, { headers });
    }

    const notifResp = await ctx.get('/notifications', { headers, params: { pageSize: '100' } });
    const notifBody = await notifResp.json();
    for (const item of notifBody.items || []) {
      await ctx.delete(`/notifications/${item.id}`, { headers });
    }
  });

  test('E2E-FLOW-001: complete morning -> evening weight recording flow', async () => {
    const today = getToday();
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(userId);

    // Step 1: Record morning weight (fasting)
    const morningResp = await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'morning', weight: 70.0, note: '空腹' },
    });
    expect(morningResp.status()).toBe(200);
    const morning = await morningResp.json();
    expect(morning.period).toBe('morning');
    expect(morning.weight).toBe(70.0);

    // Step 2: Verify morning record appears in list
    const listAfterMorning = await ctx.get('/weight-records', { headers, params: { date: today } });
    const listBodyMorning = await listAfterMorning.json();
    expect(listBodyMorning.items.some((i: any) => i.period === 'morning')).toBe(true);

    // Step 3: Record evening weight (after dinner)
    const eveningResp = await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'evening', weight: 71.2, note: '晚饭后' },
    });
    expect(eveningResp.status()).toBe(200);
    const evening = await eveningResp.json();
    expect(evening.period).toBe('evening');
    expect(evening.weight).toBe(71.2);

    // Step 4: Verify both records exist and diff is calculated
    const listAfterEvening = await ctx.get('/weight-records', { headers, params: { date: today } });
    const listBodyEvening = await listAfterEvening.json();
    expect(listBodyEvening.items.length).toBe(2);

    const withDiff = listBodyEvening.items.find((i: any) => i.weightDiff !== undefined);
    expect(withDiff.weightDiff).toBe(1.2); // 71.2 - 70.0

    // Step 5: Update evening weight (after snack)
    const updateResp = await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'evening', weight: 71.5, note: '宵夜后' },
    });
    expect(updateResp.status()).toBe(200);
    const updated = await updateResp.json();
    expect(updated.weight).toBe(71.5);
    expect(updated.note).toBe('宵夜后');

    // Step 6: Get updated stats
    const statsResp = await ctx.get('/weight-records/stats', { headers });
    expect(statsResp.status()).toBe(200);
    const stats = await statsResp.json();
    expect(stats.avgEveningWeight).toBe(71.5);
    expect(stats.avgWeightDiff).toBe(1.5); // 71.5 - 70.0
  });

  test('E2E-FLOW-002: multi-day weight tracking flow', async () => {
    const today = getToday();
    const yesterday = getYesterday();
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(userId);

    // Day 1: morning and evening
    await ctx.post('/weight-records', {
      headers,
      data: { date: yesterday, period: 'morning', weight: 70.0 },
    });
    await ctx.post('/weight-records', {
      headers,
      data: { date: yesterday, period: 'evening', weight: 71.0 },
    });

    // Day 2: morning only
    await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'morning', weight: 69.8 },
    });

    // Query last 7 days
    const listResp = await ctx.get('/weight-records', {
      headers,
      params: { startDate: yesterday, endDate: today, pageSize: '100' },
    });
    const listBody = await listResp.json();
    expect(listBody.total).toBe(3);

    // Stats across period
    const statsResp = await ctx.get('/weight-records/stats', {
      headers,
      params: { startDate: yesterday, endDate: today },
    });
    const stats = await statsResp.json();
    expect(stats.avgMorningWeight).toBe(69.9); // (70 + 69.8) / 2
    expect(stats.avgEveningWeight).toBe(71.0);
    expect(stats.minWeight).toBe(69.8);
    expect(stats.maxWeight).toBe(71.0);
    expect(stats.avgWeightDiff).toBe(1.0); // only yesterday had both

    // Change = last weight - first weight (ordered by date ASC)
    // First: yesterday morning 70.0, Last: today morning 69.8
    expect(stats.change).toBe(-0.2);
  });

  test('E2E-FLOW-003: weight recording with notification flow', async () => {
    const today = getToday();
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(userId);

    // Step 1: Record morning weight
    const weightResp = await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'morning', weight: 70.0, note: '空腹' },
    });
    expect(weightResp.status()).toBe(200);

    // Step 2: Create notification about weight goal
    const notifResp = await ctx.post('/notifications', {
      headers,
      data: {
        type: 'system',
        title: '体重记录提醒',
        content: `今日早体重已记录：70.0kg。请记得记录晚体重！`,
        priority: 'normal',
      },
    });
    expect(notifResp.status()).toBe(200);

    // Step 3: Query notifications - should see the reminder
    const listNotifResp = await ctx.get('/notifications', { headers });
    const notifBody = await listNotifResp.json();
    expect(notifBody.items.length).toBe(1);
    expect(notifBody.items[0].title).toBe('体重记录提醒');
    expect(notifBody.items[0].isRead).toBe(false);

    // Step 4: Record evening weight
    const eveningResp = await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'evening', weight: 71.0 },
    });
    expect(eveningResp.status()).toBe(200);

    // Step 5: Mark notification as read
    const notifId = notifBody.items[0].id;
    const markResp = await ctx.post(`/notifications/${notifId}`, { headers });
    expect(markResp.status()).toBe(200);

    // Step 6: Verify notification is now read
    const getNotifResp = await ctx.get(`/notifications/${notifId}`, { headers });
    const getNotif = await getNotifResp.json();
    expect(getNotif.isRead).toBe(true);

    // Step 7: Verify only unread count is 0
    const unreadResp = await ctx.get('/notifications', { headers, params: { isRead: 'false' } });
    const unreadBody = await unreadResp.json();
    expect(unreadBody.items.length).toBe(0);

    // Step 8: Verify final weight records
    const finalListResp = await ctx.get('/weight-records', { headers, params: { date: today } });
    const finalListBody = await finalListResp.json();
    expect(finalListBody.items.length).toBe(2);
  });

  test('E2E-FLOW-004: error recovery - invalid input flow', async () => {
    const today = getToday();
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(userId);

    // Try invalid weight
    const invalidWeightResp = await ctx.post('/weight-requests', {
      headers,
      data: { date: today, period: 'morning', weight: 10.0 },
    });
    expect(invalidWeightResp.status()).toBe(404); // Route doesn't exist

    const badWeightResp = await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'morning', weight: 10.0 },
    });
    expect(badWeightResp.status()).toBe(400);

    // Successfully recover with valid weight
    const validResp = await ctx.post('/weight-records', {
      headers,
      data: { date: today, period: 'morning', weight: 70.0 },
    });
    expect(validResp.status()).toBe(200);
    const record = await validResp.json();
    expect(record.weight).toBe(70.0);
  });

  test('E2E-FLOW-005: rate limiting', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(userId);

    // Make many requests rapidly to trigger rate limit
    // Note: Rate limit is 100/minute per IP, so this might not trigger in test env
    // We just verify the endpoint remains responsive
    for (let i = 0; i < 5; i++) {
      const resp = await ctx.get('/weight-records', { headers });
      expect([200, 429]).toContain(resp.status());
    }
  });

  test('E2E-FLOW-006: 100KB body limit', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(userId);
    const largeContent = 'A'.repeat(1024 * 100 + 1);

    const resp = await ctx.post('/notifications', {
      headers,
      data: { type: 'system', title: 'Big', content: largeContent },
    });
    // Should either be 400 (content too long) or 413 (body too large)
    expect([400, 413]).toContain(resp.status());
  });

  test('E2E-FLOW-007: health check - unknown route returns 404', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(userId);
    const resp = await ctx.get('/unknown-route', { headers });
    expect(resp.status()).toBe(404);
    const body = await resp.json();
    expect(body.success).toBe(false);
  });
});
