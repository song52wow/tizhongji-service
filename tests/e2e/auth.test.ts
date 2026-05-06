import { test, expect, request } from '@playwright/test';
import { generateAuthHeaders, TEST_USER_A, TEST_USER_B } from './auth';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

test.describe('HMAC Authentication', () => {
  test('E2E-AUTH-001: valid HMAC signature should be accepted', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders(TEST_USER_A);
    const response = await ctx.get('/weight-records', { headers });
    expect(response.status()).toBe(200);
  });

  test('E2E-AUTH-002: missing X-User-Id header should return 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const response = await ctx.get('/weight-records', {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('未认证或签名无效');
  });

  test('E2E-AUTH-003: missing X-User-Signature header should return 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const response = await ctx.get('/weight-records', {
      headers: { 'Content-Type': 'application/json', 'X-User-Id': TEST_USER_A },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  test('E2E-AUTH-004: invalid X-User-Id format (special chars) should return 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headers = generateAuthHeaders('invalid@user!');
    const response = await ctx.get('/weight-records', { headers });
    expect(response.status()).toBe(401);
  });

  test('E2E-AUTH-005: invalid signature should return 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const response = await ctx.get('/weight-records', {
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': TEST_USER_A,
        'X-User-Signature': 'invalid-signature-0000000000000000000000000000000000000000000000000000000000000000',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('E2E-AUTH-006: OPTIONS preflight should return 204', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const response = await ctx.fetch('/weight-records', { method: 'OPTIONS' });
    expect(response.status()).toBe(204);
  });

  test('E2E-AUTH-007: different userIds should have different signatures', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const headersA = generateAuthHeaders(TEST_USER_A);
    const headersB = generateAuthHeaders(TEST_USER_B);

    // Both should succeed independently
    const respA = await ctx.get('/weight-records', { headers: headersA });
    const respB = await ctx.get('/weight-records', { headers: headersB });
    expect(respA.status()).toBe(200);
    expect(respB.status()).toBe(200);

    // Signatures should be different
    expect(headersA['X-User-Signature']).not.toBe(headersB['X-User-Signature']);
  });
});
