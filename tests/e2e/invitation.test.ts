import { test, expect, request } from '@playwright/test';
import { generateAuthHeaders, TEST_USER_A, TEST_USER_B } from './auth';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

test.describe('Invitation Code E2E Tests', () => {
  const uniqueSuffix = Date.now().toString();
  const userA = `${TEST_USER_A}-inv-${uniqueSuffix}`;
  const userB = `${TEST_USER_B}-inv-${uniqueSuffix}`;
  let generatedCode: string;

  test.describe('Generate Invitation Code', () => {
    test('E2E-INV-001: generates an invitation code', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/invitations/generate`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.id).toBeDefined();
      expect(body.code).toBeDefined();
      expect(body.code.length).toBe(8);
      expect(body.creatorUserId).toBe(userA);
      expect(body.isUsed).toBe(false);
      expect(body.createdAt).toBeDefined();
      expect(body.usedByUserId).toBeUndefined();
      expect(body.usedAt).toBeUndefined();

      generatedCode = body.code;
    });

    test('E2E-INV-002: generates a valid alphanumeric code', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.post(`${BASE_URL}/invitations/generate`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.code).toMatch(/^[A-Z0-9]+$/);
    });

    test('E2E-INV-003: multiple generations produce unique codes', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const codes = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const response = await ctx.post(`${BASE_URL}/invitations/generate`, { headers });
        const body = await response.json();
        codes.add(body.code);
      }
      expect(codes.size).toBe(5);
    });
  });

  test.describe('List Invitation Codes', () => {
    test('E2E-INV-004: lists own invitation codes', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.get(`${BASE_URL}/invitations`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(6); // 1 from INV-001 + 5 from INV-003

      for (const code of body.data) {
        expect(code.creatorUserId).toBe(userA);
      }
    });

    test('E2E-INV-005: sorted by created_at descending', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      const response = await ctx.get(`${BASE_URL}/invitations`, { headers });
      const body = await response.json();
      const dates = body.data.map((c: any) => c.createdAt);
      expect(dates).toEqual([...dates].sort().reverse());
    });

    test('E2E-INV-006: returns empty list for new user', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const freshUser = `fresh-user-inv-${uniqueSuffix}`;
      const headers = generateAuthHeaders(freshUser);

      const response = await ctx.get(`${BASE_URL}/invitations`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data).toEqual([]);
    });
  });

  test.describe('Redeem Invitation Code', () => {
    test('E2E-INV-007: redeems a valid invitation code', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });

      // User A generates a code for user B to redeem
      const headersA = generateAuthHeaders(userA);
      const genResp = await ctx.post(`${BASE_URL}/invitations/generate`, { headers: headersA });
      const genBody = await genResp.json();
      const codeToRedeem = genBody.code;

      // User B redeems it
      const headersB = generateAuthHeaders(userB);
      const redeemResp = await ctx.post(`${BASE_URL}/invitations/redeem`, {
        headers: headersB,
        data: { code: codeToRedeem },
      });
      expect(redeemResp.status()).toBe(200);
      const redeemBody = await redeemResp.json();
      expect(redeemBody.success).toBe(true);
      expect(redeemBody.message).toContain('兑换成功');
    });

    test('E2E-INV-008: cannot redeem same code twice', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });

      // Create a fresh user for this test
      const creator = `creator-inv-${uniqueSuffix}`;
      const redeemer1 = `redeemer1-inv-${uniqueSuffix}`;
      const redeemer2 = `redeemer2-inv-${uniqueSuffix}`;

      // Generate
      const headersCreator = generateAuthHeaders(creator);
      const genResp = await ctx.post(`${BASE_URL}/invitations/generate`, { headers: headersCreator });
      const code = (await genResp.json()).code;

      // First redeem - should succeed
      const headersR1 = generateAuthHeaders(redeemer1);
      const r1 = await ctx.post(`${BASE_URL}/invitations/redeem`, {
        headers: headersR1,
        data: { code },
      });
      expect(r1.status()).toBe(200);

      // Second redeem - should fail
      const headersR2 = generateAuthHeaders(redeemer2);
      const r2 = await ctx.post(`${BASE_URL}/invitations/redeem`, {
        headers: headersR2,
        data: { code },
      });
      expect(r2.status()).toBe(400);
      const body = await r2.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('已被使用');
    });

    test('E2E-INV-009: cannot use own invitation code', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userA);

      // Generate a code for user A
      const genResp = await ctx.post(`${BASE_URL}/invitations/generate`, { headers });
      const code = (await genResp.json()).code;

      // Try to redeem own code
      const redeemResp = await ctx.post(`${BASE_URL}/invitations/redeem`, {
        headers,
        data: { code },
      });
      expect(redeemResp.status()).toBe(400);
      const body = await redeemResp.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('自己的');
    });

    test('E2E-INV-010: returns 404 for non-existent code', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userB);

      const response = await ctx.post(`${BASE_URL}/invitations/redeem`, {
        headers,
        data: { code: 'XXXX1234' },
      });
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('不存在');
    });

    test('E2E-INV-011: rejects empty code', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });
      const headers = generateAuthHeaders(userB);

      const response = await ctx.post(`${BASE_URL}/invitations/redeem`, {
        headers,
        data: { code: '' },
      });
      expect(response.status()).toBe(400);
    });

    test('E2E-INV-012: code redemption is case insensitive', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });

      const creator = `creator-case-inv-${uniqueSuffix}`;
      const redeemer = `redeemer-case-inv-${uniqueSuffix}`;

      // Generate
      const headersCreator = generateAuthHeaders(creator);
      const genResp = await ctx.post(`${BASE_URL}/invitations/generate`, { headers: headersCreator });
      const code = (await genResp.json()).code;

      // Redeem with lowercase
      const headersR = generateAuthHeaders(redeemer);
      const redeemResp = await ctx.post(`${BASE_URL}/invitations/redeem`, {
        headers: headersR,
        data: { code: code.toLowerCase() },
      });
      expect(redeemResp.status()).toBe(200);
      const body = await redeemResp.json();
      expect(body.success).toBe(true);
    });
  });

  test.describe('Code Status Tracking', () => {
    test('E2E-INV-013: redeemed code shows as used in list', async () => {
      const ctx = await request.newContext({ baseURL: BASE_URL });

      const creator = `creator-status-inv-${uniqueSuffix}`;
      const redeemer = `redeemer-status-inv-${uniqueSuffix}`;

      // Generate
      const headersCreator = generateAuthHeaders(creator);
      const genResp = await ctx.post(`${BASE_URL}/invitations/generate`, { headers: headersCreator });
      const genBody = await genResp.json();
      const codeValue = genBody.code;
      const codeId = genBody.id;

      // Redeem
      const headersR = generateAuthHeaders(redeemer);
      await ctx.post(`${BASE_URL}/invitations/redeem`, {
        headers: headersR,
        data: { code: codeValue },
      });

      // Verify status
      const listResp = await ctx.get(`${BASE_URL}/invitations`, { headers: headersCreator });
      const listBody = await listResp.json();
      const redeemedCode = listBody.data.find((c: any) => c.id === codeId);
      expect(redeemedCode).toBeDefined();
      expect(redeemedCode.isUsed).toBe(true);
      expect(redeemedCode.usedByUserId).toBe(redeemer);
      expect(redeemedCode.usedAt).toBeDefined();
    });
  });
});
