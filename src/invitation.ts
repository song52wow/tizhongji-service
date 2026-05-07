import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDb } from './db';
import type { InvitationCode, RedeemInvitationInput, ErrorResponse } from './types';

const CODE_LENGTH = 8;

function generateCode(): string {
  // Generate a readable alphanumeric code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function toInvitationCode(row: Record<string, unknown>): InvitationCode {
  return {
    id: row['id'] as string,
    code: row['code'] as string,
    creatorUserId: row['creator_user_id'] as string,
    isUsed: (row['is_used'] as number) === 1,
    usedByUserId: (row['used_by_user_id'] as string | undefined) ?? undefined,
    createdAt: row['created_at'] as string,
    usedAt: (row['used_at'] as string | undefined) ?? undefined,
  };
}

export function generateInvitationCode(creatorUserId: string): InvitationCode | ErrorResponse {
  if (!creatorUserId || typeof creatorUserId !== 'string' || creatorUserId.trim() === '') {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = uuidv4();

  // Generate a unique code (retry on collision)
  let code: string;
  let attempts = 0;
  do {
    code = generateCode();
    const existing = db.prepare('SELECT id FROM invitation_codes WHERE code = ?').get(code);
    if (!existing) break;
    attempts++;
  } while (attempts < 10);

  if (attempts >= 10) {
    return { success: false, error: '生成邀请码失败，请重试', statusCode: 500 };
  }

  const stmt = db.prepare(`
    INSERT INTO invitation_codes (id, code, creator_user_id, is_used, created_at)
    VALUES (?, ?, ?, 0, ?)
  `);
  stmt.run(id, code, creatorUserId.trim(), now);

  const row = db.prepare('SELECT * FROM invitation_codes WHERE id = ?').get(id) as Record<string, unknown>;
  return toInvitationCode(row);
}

export function redeemInvitationCode(input: RedeemInvitationInput): { success: boolean; message: string } | ErrorResponse {
  if (!input.userId || typeof input.userId !== 'string' || input.userId.trim() === '') {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }
  if (!input.code || typeof input.code !== 'string' || input.code.trim() === '') {
    return { success: false, error: '邀请码不能为空', statusCode: 400 };
  }

  const db = getDb();
  const trimmedCode = input.code.trim().toUpperCase();

  const codeRow = db.prepare(
    'SELECT * FROM invitation_codes WHERE code = ?'
  ).get(trimmedCode) as Record<string, unknown> | undefined;

  if (!codeRow) {
    return { success: false, error: '邀请码不存在', statusCode: 404 };
  }

  if ((codeRow['is_used'] as number) === 1) {
    return { success: false, error: '邀请码已被使用', statusCode: 400 };
  }

  if (codeRow['creator_user_id'] === input.userId.trim()) {
    return { success: false, error: '不能使用自己的邀请码', statusCode: 400 };
  }

  const now = new Date().toISOString();
  db.prepare(
    'UPDATE invitation_codes SET is_used = 1, used_by_user_id = ?, used_at = ? WHERE id = ?'
  ).run(input.userId.trim(), now, codeRow['id']);

  return { success: true, message: '邀请码兑换成功' };
}

export function listInvitationCodes(creatorUserId: string): InvitationCode[] | ErrorResponse {
  if (!creatorUserId) {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }

  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM invitation_codes WHERE creator_user_id = ? ORDER BY created_at DESC'
  ).all(creatorUserId.trim()) as Record<string, unknown>[];

  return rows.map(toInvitationCode);
}
