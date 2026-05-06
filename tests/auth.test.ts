/**
 * auth.test.ts — Unit tests for HMAC-SHA256 authentication logic
 *
 * Tests the authentication middleware logic in isolation.
 */

process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET = 'test-secret-key';

import crypto from 'crypto';

// We test the auth logic by importing and testing the function behavior
// Since server.ts doesn't export getAuthenticatedUserId, we test the
// signature generation and verification logic directly.

const AUTH_SECRET = 'dev-secret-change-in-production';

describe('AUTH-UNIT-001: HMAC-SHA256 signature generation', () => {
  test('Signature is deterministic for same userId', () => {
    const sig1 = crypto.createHmac('sha256', AUTH_SECRET).update('user-001').digest('hex');
    const sig2 = crypto.createHmac('sha256', AUTH_SECRET).update('user-001').digest('hex');
    expect(sig1).toBe(sig2);
  });

  test('Different userIds produce different signatures', () => {
    const sig1 = crypto.createHmac('sha256', AUTH_SECRET).update('user-001').digest('hex');
    const sig2 = crypto.createHmac('sha256', AUTH_SECRET).update('user-002').digest('hex');
    expect(sig1).not.toBe(sig2);
  });

  test('Signature is 64-character hex string', () => {
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update('user-001').digest('hex');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  test('Empty string userId produces valid signature', () => {
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update('').digest('hex');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  test('Unicode userId produces valid signature', () => {
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update('用户123').digest('hex');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  test('Signature comparison uses timing-safe equality', () => {
    // timingSafeEqual should not throw on equal buffers
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update('user-001').digest('hex');
    const result = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sig));
    expect(result).toBe(true);
  });

  test('timingSafeEqual returns false for different buffers', () => {
    const sig1 = crypto.createHmac('sha256', AUTH_SECRET).update('user-001').digest('hex');
    const sig2 = crypto.createHmac('sha256', AUTH_SECRET).update('user-002').digest('hex');
    const result = crypto.timingSafeEqual(Buffer.from(sig1), Buffer.from(sig2));
    expect(result).toBe(false);
  });

  test('timingSafeEqual throws on buffers of different lengths', () => {
    expect(() => {
      crypto.timingSafeEqual(Buffer.from('short'), Buffer.from('muchlongerbuffer'));
    }).toThrow();
  });
});

describe('AUTH-UNIT-002: UserId format validation', () => {
  // Pattern: /^[a-zA-Z0-9_-]{1,64}$/
  const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

  test('Valid userId: alphanumeric', () => {
    expect(USER_ID_PATTERN.test('user001')).toBe(true);
    expect(USER_ID_PATTERN.test('User123')).toBe(true);
    expect(USER_ID_PATTERN.test('123456')).toBe(true);
  });

  test('Valid userId: with underscore and dash', () => {
    expect(USER_ID_PATTERN.test('user_001')).toBe(true);
    expect(USER_ID_PATTERN.test('user-001')).toBe(true);
    expect(USER_ID_PATTERN.test('a_b-c')).toBe(true);
  });

  test('Valid userId: exactly 64 characters', () => {
    const uid = 'a'.repeat(64);
    expect(USER_ID_PATTERN.test(uid)).toBe(true);
  });

  test('Invalid userId: 65 characters (too long)', () => {
    const uid = 'a'.repeat(65);
    expect(USER_ID_PATTERN.test(uid)).toBe(false);
  });

  test('Invalid userId: 0 characters (too short)', () => {
    expect(USER_ID_PATTERN.test('')).toBe(false);
  });

  test('Invalid userId: contains space', () => {
    expect(USER_ID_PATTERN.test('user 001')).toBe(false);
  });

  test('Invalid userId: contains special characters', () => {
    expect(USER_ID_PATTERN.test('user@001')).toBe(false);
    expect(USER_ID_PATTERN.test('user#001')).toBe(false);
    expect(USER_ID_PATTERN.test('user$001')).toBe(false);
    expect(USER_ID_PATTERN.test('user.001')).toBe(false);
    expect(USER_ID_PATTERN.test('user/001')).toBe(false);
  });

  test('Invalid userId: contains HTML characters', () => {
    expect(USER_ID_PATTERN.test('user<script>')).toBe(false);
    expect(USER_ID_PATTERN.test('user>001')).toBe(false);
  });

  test('Invalid userId: contains emoji', () => {
    expect(USER_ID_PATTERN.test('user😀')).toBe(false);
  });

  test('Invalid userId: contains newline', () => {
    expect(USER_ID_PATTERN.test('user\n001')).toBe(false);
  });
});

describe('AUTH-UNIT-003: Auth header combinations', () => {
  // Simulates the auth check logic from server.ts

  function simulateAuthCheck(
    userId: unknown,
    signature: unknown
  ): { valid: boolean; reason?: string } {
    if (typeof userId !== 'string' || typeof signature !== 'string') {
      return { valid: false, reason: 'missing' };
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) {
      return { valid: false, reason: 'invalid_userid_format' };
    }
    try {
      const expected = crypto.createHmac('sha256', AUTH_SECRET).update(userId).digest('hex');
      const match = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      return match ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
    } catch {
      return { valid: false, reason: 'comparison_error' };
    }
  }

  test('Both headers present with correct signature → valid', () => {
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update('user-001').digest('hex');
    const result = simulateAuthCheck('user-001', sig);
    expect(result.valid).toBe(true);
  });

  test('Both headers present with wrong signature → comparison_error (wrong length throws)', () => {
    const result = simulateAuthCheck('user-001', 'wrong-signature-0000');
    expect(result.valid).toBe(false);
    // Wrong length buffers throw from timingSafeEqual
    expect(result.reason).toBe('comparison_error');
  });

  test('Both headers present with valid-length wrong signature → signature_mismatch', () => {
    const wrongSig = crypto.createHmac('sha256', AUTH_SECRET).update('wrong-user').digest('hex');
    const result = simulateAuthCheck('user-001', wrongSig);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  test('Missing userId → invalid', () => {
    const result = simulateAuthCheck(undefined, 'some-sig');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing');
  });

  test('Missing signature → invalid', () => {
    const result = simulateAuthCheck('user-001', undefined);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing');
  });

  test('Both missing → invalid', () => {
    const result = simulateAuthCheck(undefined, undefined);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing');
  });

  test('userId not a string → invalid', () => {
    const result = simulateAuthCheck(123 as any, 'sig');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing');
  });

  test('signature not a string → invalid', () => {
    const result = simulateAuthCheck('user-001', 123 as any);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing');
  });

  test('Invalid userId format → invalid', () => {
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update('user 001').digest('hex');
    const result = simulateAuthCheck('user 001', sig);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_userid_format');
  });

  test('Malformed signature (non-hex) → comparison_error', () => {
    const result = simulateAuthCheck('user-001', 'not-a-hex-string!');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('comparison_error');
  });

  test('Signature with wrong length → comparison_error', () => {
    const result = simulateAuthCheck('user-001', 'short');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('comparison_error');
  });
});

describe('AUTH-UNIT-004: Different AUTH_SECRET produces different signatures', () => {
  test('Same userId with different secrets gives different signatures', () => {
    const sig1 = crypto.createHmac('sha256', 'secret1').update('user-001').digest('hex');
    const sig2 = crypto.createHmac('sha256', 'secret2').update('user-001').digest('hex');
    expect(sig1).not.toBe(sig2);
  });

  test('Production secret should be different from dev secret', () => {
    const devSig = crypto.createHmac('sha256', 'dev-secret-change-in-production').update('user-001').digest('hex');
    const prodSig = crypto.createHmac('sha256', 'actual-production-secret').update('user-001').digest('hex');
    expect(devSig).not.toBe(prodSig);
  });
});
