import { resetDb, getDb, closeDb } from '../src/db';
import { generateInvitationCode, redeemInvitationCode, listInvitationCodes } from '../src/invitation';

beforeEach(() => {
  resetDb();
  getDb(true);
});

afterAll(() => {
  closeDb();
});

describe('generateInvitationCode', () => {
  it('should generate a valid invitation code', () => {
    const result = generateInvitationCode('user1');
    const code = result as any;

    expect(code.id).toBeDefined();
    expect(code.code).toBeDefined();
    expect(code.code).toHaveLength(8);
    expect(code.creatorUserId).toBe('user1');
    expect(code.isUsed).toBe(false);
    expect(code.createdAt).toBeDefined();
  });

  it('should generate unique codes on subsequent calls', () => {
    const result1 = generateInvitationCode('user1') as any;
    const result2 = generateInvitationCode('user1') as any;

    expect(result1.code).not.toBe(result2.code);
  });

  it('should reject empty userId', () => {
    const result = generateInvitationCode('');
    expect(result).toHaveProperty('success', false);
    expect((result as any).error).toContain('userId');
  });

  it('should trim whitespace from userId', () => {
    const result = generateInvitationCode('  user1  ');
    expect((result as any).creatorUserId).toBe('user1');
  });

  it('should accept non-string types as invalid', () => {
    const result = generateInvitationCode(undefined as any);
    expect(result).toHaveProperty('success', false);
  });

  it('should generate codes only from readable characters', () => {
    const result = generateInvitationCode('user1') as any;
    // Should not contain confusing chars like I, O, 0, 1
    expect(result.code).toMatch(/^[A-Z2-9]+$/);
  });
});

describe('redeemInvitationCode', () => {
  it('should successfully redeem a valid invitation code', () => {
    const generated = generateInvitationCode('user1') as any;

    const result = redeemInvitationCode({ userId: 'user2', code: generated.code });
    expect(result).toEqual({ success: true, message: '邀请码兑换成功' });
  });

  it('should not redeem an already used code', () => {
    const generated = generateInvitationCode('user1') as any;
    redeemInvitationCode({ userId: 'user2', code: generated.code });

    const result = redeemInvitationCode({ userId: 'user3', code: generated.code });
    expect(result).toHaveProperty('success', false);
    expect((result as any).error).toContain('已被使用');
  });

  it('should not allow redeeming own code', () => {
    const generated = generateInvitationCode('user1') as any;

    const result = redeemInvitationCode({ userId: 'user1', code: generated.code });
    expect(result).toHaveProperty('success', false);
    expect((result as any).error).toContain('自己的');
  });

  it('should return 404 for non-existent code', () => {
    const result = redeemInvitationCode({ userId: 'user2', code: 'XXXXXXXX' });
    expect(result).toHaveProperty('success', false);
    expect((result as any).statusCode).toBe(404);
  });

  it('should reject empty userId', () => {
    const result = redeemInvitationCode({ userId: '', code: 'ABC123' });
    expect(result).toHaveProperty('success', false);
  });

  it('should reject empty code', () => {
    const result = redeemInvitationCode({ userId: 'user1', code: '' });
    expect(result).toHaveProperty('success', false);
  });

  it('should be case-insensitive when redeeming', () => {
    const generated = generateInvitationCode('user1') as any;
    const lower = generated.code.toLowerCase();

    const result = redeemInvitationCode({ userId: 'user2', code: lower });
    expect(result).toEqual({ success: true, message: '邀请码兑换成功' });
  });
});

describe('listInvitationCodes', () => {
  it('should list codes created by user', () => {
    generateInvitationCode('user1');
    generateInvitationCode('user1');

    const result = listInvitationCodes('user1');
    expect(result).toHaveLength(2);
  });

  it('should return empty array for user with no codes', () => {
    const result = listInvitationCodes('nobody');
    expect(result).toEqual([]);
  });

  it('should not list codes from other users', () => {
    generateInvitationCode('user1');
    generateInvitationCode('user2');

    const result = listInvitationCodes('user1');
    expect(result).toHaveLength(1);
  });

  it('should reflect used status after redemption', () => {
    const generated = generateInvitationCode('user1') as any;
    redeemInvitationCode({ userId: 'user2', code: generated.code });

    const codes = listInvitationCodes('user1') as any[];
    expect(codes).toHaveLength(1);
    expect(codes[0].isUsed).toBe(true);
    expect(codes[0].usedByUserId).toBe('user2');
  });

  it('should reject empty userId', () => {
    const result = listInvitationCodes('');
    expect(result).toHaveProperty('success', false);
  });
});
