import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-change-in-production';

export interface AuthHeaders {
  'X-User-Id': string;
  'X-User-Signature': string;
  'Content-Type': string;
}

export function generateAuthHeaders(userId: string): AuthHeaders {
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(userId).digest('hex');
  return {
    'X-User-Id': userId,
    'X-User-Signature': signature,
    'Content-Type': 'application/json',
  };
}

export const TEST_USER_A = 'test-user-a';
export const TEST_USER_B = 'test-user-b';
