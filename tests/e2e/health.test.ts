import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

test.describe('Health Check E2E', () => {
  test('E2E-HEALTH-001: health endpoint returns 200 without auth', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const response = await ctx.get('/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(body.uptime).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.version).toBe('1.0.0');
    expect(body.durationMs).toBeDefined();
    expect(typeof body.durationMs).toBe('number');
  });

  test('E2E-HEALTH-002: health endpoint accessible from allowed origin with CORS', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const response = await ctx.get('/health', {
      headers: { 'Origin': 'http://localhost:8080' },
    });
    expect(response.status()).toBe(200);
    // CORS headers should be set for allowed origins
    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe('http://localhost:8080');
    expect(headers['access-control-allow-methods']).toContain('GET');
  });

  test('E2E-HEALTH-003: health endpoint returns JSON content-type', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const response = await ctx.get('/health');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-type']).toContain('application/json');
  });

  test('E2E-HEALTH-004: health endpoint is not affected by rate limiting', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    // Make many rapid requests to health endpoint
    for (let i = 0; i < 10; i++) {
      const response = await ctx.get('/health');
      expect(response.status()).toBe(200);
    }
  });

  test('E2E-HEALTH-005: health uptime increases over time', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const resp1 = await ctx.get('/health');
    const body1 = await resp1.json();
    const uptime1 = body1.uptime;

    // Wait 1100ms
    await new Promise(r => setTimeout(r, 1100));

    const resp2 = await ctx.get('/health');
    const body2 = await resp2.json();
    expect(body2.uptime).toBeGreaterThanOrEqual(uptime1 + 1);
  });
});
