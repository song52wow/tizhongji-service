// Load .env file if present
import fs from 'fs';
import path from 'path';
import http, { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import './db'; // Ensure .env is loaded and DB is initialized before other modules
import { upsertWeightRecord, listWeightRecords, getWeightRecordById, deleteWeightRecord, calculateWeightStats } from './weight-record';
import { createNotification, listNotifications, markAsRead, markAllAsRead, deleteNotification, getNotificationById } from './notification';
import { createReminder, listReminders, updateReminder, deleteReminder } from './reminder';
import { generateInvitationCode, redeemInvitationCode, listInvitationCodes } from './invitation';
import { recordActivity, getAchievementStats } from './achievement';
import { logger } from './logger';
import type { CreateWeightRecordInput, WeightRecordQuery, CreateNotificationInput, NotificationListQuery, CreateReminderInput, RedeemInvitationInput } from './types';

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-change-in-production';
const MAX_BODY_SIZE = 1024 * 100;
const PORT = parseInt(process.env.PORT || '3000', 10);
const START_TIME = Date.now();

// Rate limiting: 100 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, RATE_LIMIT_WINDOW).unref();

function parseBody<T>(req: http.IncomingMessage, maxSize = MAX_BODY_SIZE): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function getAuthenticatedUserId(req: http.IncomingMessage): string | null {
  const userId = req.headers['x-user-id'];
  const signature = req.headers['x-user-signature'];
  if (typeof userId !== 'string' || typeof signature !== 'string') return null;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) return null;
  try {
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(userId).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? userId : null;
  } catch {
    return null;
  }
}

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8080,https://tizhongji.cisonc.site').split(',').map(s => s.trim()).filter(Boolean)
);

function getPathSegments(url: string): { path: string[]; query: Record<string, string> } {
  const [pathname, queryStr] = url.split('?');
  const path = pathname.split('/').filter(Boolean);
  const query: Record<string, string> = {};
  if (queryStr) {
    for (const pair of queryStr.split('&')) {
      const [key, value] = pair.split('=');
      if (key) query[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  }
  return { path, query };
}

function parseBoolParam(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: message }));
}

function requestLogger(req: http.IncomingMessage, userId: string | null, status: number, durationMs: number) {
  const logData = {
    method: req.method,
    url: req.url,
    userId,
    status,
    durationMs,
    ip: req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
  };
  if (status >= 500) {
    logger.error('Request failed', logData);
  } else if (status >= 400) {
    logger.warn('Request error', logData);
  } else {
    logger.info('Request', logData);
  }
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const startMs = Date.now();
  const origin = req.headers['origin'];
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, X-User-Signature');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint (no auth required)
  if (req.method === 'GET' && req.url === '/health') {
    const durationMs = Date.now() - startMs;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - START_TIME) / 1000),
      version: '1.0.0',
      durationMs,
    }));
    return;
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '请求过于频繁，请稍后再试' }));
    return;
  }

  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    sendError(res, 401, '未认证或签名无效');
    return;
  }

  try {
    const { path, query } = getPathSegments(req.url || '');

    // ============ Weight Record API ============

    if (path[0] === 'weight-records' && path.length === 1 && req.method === 'POST') {
      const input = await parseBody<CreateWeightRecordInput>(req);
      const enforcedInput = { ...input, userId };
      const result = upsertWeightRecord(enforcedInput);
      if ('success' in result && !result.success) {
        jsonResponse(res, result.statusCode, result);
      } else {
        jsonResponse(res, 200, result);
      }
      requestLogger(req, userId, 200, Date.now() - startMs);
      return;
    }

    if (path[0] === 'weight-records' && path.length === 1 && req.method === 'GET') {
      const safeQuery: WeightRecordQuery = { ...query as unknown as WeightRecordQuery, userId };
      if (query['period']) {
        (safeQuery as any).period = query['period'];
      }
      const result = listWeightRecords(safeQuery);
      if ('success' in result && !result.success) {
        jsonResponse(res, result.statusCode, result);
      } else {
        jsonResponse(res, 200, result);
      }
      requestLogger(req, userId, 200, Date.now() - startMs);
      return;
    }

    if (path[0] === 'weight-records' && path[1] === 'stats' && path.length === 2 && req.method === 'GET') {
      const safeQuery: WeightRecordQuery = {
        ...query as unknown as WeightRecordQuery,
        userId,
      };
      const result = calculateWeightStats(safeQuery);
      if ('success' in result && !result.success) {
        jsonResponse(res, result.statusCode, result);
      } else {
        jsonResponse(res, 200, result);
      }
      requestLogger(req, userId, 200, Date.now() - startMs);
      return;
    }

    if (path[0] === 'weight-records' && path.length === 2 && req.method === 'GET') {
      const record = getWeightRecordById(path[1], userId);
      if ('success' in record && !record.success) {
        jsonResponse(res, (record as any).statusCode, record);
        requestLogger(req, userId, (record as any).statusCode, Date.now() - startMs);
        return;
      }
      jsonResponse(res, 200, record);
      requestLogger(req, userId, 200, Date.now() - startMs);
      return;
    }

    if (path[0] === 'weight-records' && path.length === 2 && req.method === 'DELETE') {
      const result = deleteWeightRecord(path[1], userId);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode || 400, result);
        requestLogger(req, userId, (result as any).statusCode || 400, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, { success: true });
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    // ============ Notification API ============

    if (path[0] === 'notifications' && path.length === 1 && req.method === 'POST') {
      const input = await parseBody<CreateNotificationInput>(req);
      const enforcedInput = { ...input, userId };
      const result = createNotification(enforcedInput);
      if ('success' in result && !result.success) {
        jsonResponse(res, result.statusCode, result);
      } else {
        jsonResponse(res, 200, result);
      }
      requestLogger(req, userId, 200, Date.now() - startMs);
      return;
    }

    if (path[0] === 'notifications' && path.length === 1 && req.method === 'GET') {
      const isReadParam = parseBoolParam(query['isRead']);
      const safeQuery: NotificationListQuery = {
        ...query as unknown as NotificationListQuery,
        userId,
        ...(isReadParam !== undefined ? { isRead: isReadParam } : {}),
      };
      const result = listNotifications(safeQuery);
      if ('success' in result && !result.success) {
        jsonResponse(res, result.statusCode, result);
      } else {
        jsonResponse(res, 200, result);
      }
      requestLogger(req, userId, 200, Date.now() - startMs);
      return;
    }

    if (path[0] === 'notifications' && path.length === 2 && path[1] === 'read-all' && req.method === 'POST') {
      const result = markAllAsRead(userId);
      if ('success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode || 400, result);
        requestLogger(req, userId, (result as any).statusCode || 400, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, result);
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    if (path[0] === 'notifications' && path.length === 2 && path[1] !== 'read-all' && req.method === 'GET') {
      const notification = getNotificationById(path[1], userId);
      if ('success' in notification && !notification.success) {
        jsonResponse(res, (notification as any).statusCode, notification);
        requestLogger(req, userId, (notification as any).statusCode, Date.now() - startMs);
        return;
      }
      jsonResponse(res, 200, notification);
      requestLogger(req, userId, 200, Date.now() - startMs);
      return;
    }

    if (path[0] === 'notifications' && path.length === 2 && path[1] !== 'read-all' && req.method === 'POST') {
      const result = markAsRead(path[1], userId);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, result);
        requestLogger(req, userId, (result as any).statusCode, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, { success: true });
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    if (path[0] === 'notifications' && path.length === 2 && req.method === 'DELETE') {
      const result = deleteNotification(path[1], userId);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, result);
        requestLogger(req, userId, (result as any).statusCode, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, { success: true });
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    // ============ Reminder API ============

    if (path[0] === 'reminders' && path.length === 1 && req.method === 'POST') {
      const input = await parseBody<CreateReminderInput>(req);
      const enforcedInput = { ...input, userId };
      const result = createReminder(enforcedInput);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, result);
        requestLogger(req, userId, (result as any).statusCode, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, result);
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    if (path[0] === 'reminders' && path.length === 1 && req.method === 'GET') {
      const result = listReminders(userId);
      jsonResponse(res, 200, { success: true, data: result });
      requestLogger(req, userId, 200, Date.now() - startMs);
      return;
    }

    if (path[0] === 'reminders' && path.length === 2 && req.method === 'PUT') {
      const updates = await parseBody<{ remindTime?: string; period?: string; enabled?: boolean }>(req);
      const result = updateReminder(path[1], userId, updates);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, result);
        requestLogger(req, userId, (result as any).statusCode, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, result);
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    if (path[0] === 'reminders' && path.length === 2 && req.method === 'DELETE') {
      const result = deleteReminder(path[1], userId);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, { success: false, error: (result as any).error });
        requestLogger(req, userId, (result as any).statusCode, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, { success: true });
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    // ============ Invitation Code API ============

    if (path[0] === 'invitations' && path[1] === 'generate' && path.length === 2 && req.method === 'POST') {
      const result = generateInvitationCode(userId);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, { success: false, error: (result as any).error });
        requestLogger(req, userId, (result as any).statusCode, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, result);
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    if (path[0] === 'invitations' && path[1] === 'redeem' && path.length === 2 && req.method === 'POST') {
      const input = await parseBody<{ code: string }>(req);
      const redeemInput: RedeemInvitationInput = { userId, code: input.code };
      const result = redeemInvitationCode(redeemInput);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, { success: false, error: (result as any).error });
        requestLogger(req, userId, (result as any).statusCode, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, result);
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    if (path[0] === 'invitations' && path.length === 1 && req.method === 'GET') {
      const result = listInvitationCodes(userId);
      jsonResponse(res, 200, { success: true, data: result });
      requestLogger(req, userId, 200, Date.now() - startMs);
      return;
    }

    // ============ Achievement API ============

    if (path[0] === 'achievements' && path[1] === 'activity' && path.length === 2 && req.method === 'POST') {
      const input = await parseBody<{ activityType: string; date: string; metadata?: string }>(req);
      const result = recordActivity(userId, input.activityType as any, input.date, input.metadata);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, { success: false, error: (result as any).error });
        requestLogger(req, userId, (result as any).statusCode, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, result);
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    if (path[0] === 'achievements' && path[1] === 'stats' && path.length === 2 && req.method === 'GET') {
      const result = getAchievementStats(userId);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, { success: false, error: (result as any).error });
        requestLogger(req, userId, (result as any).statusCode, Date.now() - startMs);
      } else {
        jsonResponse(res, 200, { success: true, data: result });
        requestLogger(req, userId, 200, Date.now() - startMs);
      }
      return;
    }

    sendError(res, 404, 'Not Found');
    requestLogger(req, userId, 404, Date.now() - startMs);
  } catch (e: any) {
    if (e.message === 'Request body too large') {
      sendError(res, 413, '请求体过大，最大支持 100KB');
    } else {
      logger.error('Unhandled error', { error: e.message, stack: e.stack });
      sendError(res, 500, '服务器错误');
    }
    requestLogger(req, userId, 500, Date.now() - startMs);
  }
});

const SERVER_PORT = process.env.NODE_ENV === 'test' ? 0 : PORT;
server.listen(SERVER_PORT, () => {
  logger.info(`服务运行在 http://localhost:${SERVER_PORT}`, {
    env: process.env.NODE_ENV || 'development',
    authSecretSet: process.env.AUTH_SECRET !== undefined,
  });
});

export default server;
