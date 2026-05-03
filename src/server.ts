import http, { IncomingMessage, ServerResponse } from 'http';
import { upsertWeightRecord, listWeightRecords, getWeightRecordById, deleteWeightRecord, calculateWeightStats } from './weight-record';
import { createNotification, listNotifications, markAsRead, markAllAsRead, deleteNotification, getNotificationById } from './notification';
import type { CreateWeightRecordInput, WeightRecordQuery, CreateNotificationInput, NotificationListQuery, Notification, WeightRecord } from './types';

const MAX_BODY_SIZE = 1024 * 100; // 100KB limit

function parseBody<T>(req: http.IncomingMessage, maxSize = MAX_BODY_SIZE): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
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

function getUserId(req: http.IncomingMessage): string | null {
  const authHeader = req.headers['x-user-id'];
  if (typeof authHeader === 'string' && authHeader.trim() !== '') {
    return authHeader.trim();
  }
  return null;
}

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:8080',
]);

function parseQuery(url: string): Record<string, string> {
  const queryStr = url.split('?')[1];
  if (!queryStr) return {};
  const query: Record<string, string> = {};
  try {
    for (const pair of queryStr.split('&')) {
      const [key, value] = pair.split('=');
      if (key) query[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  } catch {
    // ignore malformed URL encoding
  }
  return query;
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

function sendError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: message }));
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers['origin'];
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const userId = getUserId(req);
  if (!userId) {
    sendError(res, 401, '未提供用户身份标识，请使用 X-User-Id Header');
    return;
  }

  // Validate userId format (non-empty alphanumeric string)
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) {
    sendError(res, 400, '无效的用户身份标识格式');
    return;
  }

  try {
    const { path, query } = getPathSegments(req.url || '');

    // ============ Weight Record API ============

    if (path[0] === 'weight-records' && path.length === 1 && req.method === 'POST') {
      const input = await parseBody<CreateWeightRecordInput>(req);
      // Enforce userId from header, ignore any userId in body
      const enforcedInput = { ...input, userId };
      const result = upsertWeightRecord(enforcedInput);
      if ('success' in result && !result.success) {
        jsonResponse(res, result.statusCode, result);
      } else {
        jsonResponse(res, 200, result);
      }
      return;
    }

    if (path[0] === 'weight-records' && path.length === 1 && req.method === 'GET') {
      // Force userId from header, ignore query userId
      const safeQuery: WeightRecordQuery = { ...query as unknown as WeightRecordQuery, userId };
      const result = listWeightRecords(safeQuery);
      if ('success' in result && !result.success) {
        jsonResponse(res, result.statusCode, result);
      } else {
        jsonResponse(res, 200, result);
      }
      return;
    }

    if (path[0] === 'weight-records' && path[1] === 'stats' && path.length === 2 && req.method === 'GET') {
      // Force userId from header
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
      return;
    }

    // GET /weight-records/:id — must verify ownership
    if (path[0] === 'weight-records' && path.length === 2 && req.method === 'GET') {
      const record = getWeightRecordById(path[1], userId);
      if ('success' in record && !record.success) {
        jsonResponse(res, (record as any).statusCode, record);
        return;
      }
      jsonResponse(res, 200, record);
      return;
    }

    // DELETE /weight-records/:id — must verify ownership
    if (path[0] === 'weight-records' && path.length === 2 && req.method === 'DELETE') {
      const result = deleteWeightRecord(path[1], userId);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode || 400, result);
      } else {
        jsonResponse(res, 200, { success: true });
      }
      return;
    }

    // ============ Notification API ============

    if (path[0] === 'notifications' && path.length === 1 && req.method === 'POST') {
      const input = await parseBody<CreateNotificationInput>(req);
      // Enforce userId from header
      const enforcedInput = { ...input, userId };
      const result = createNotification(enforcedInput);
      if ('success' in result && !result.success) {
        jsonResponse(res, result.statusCode, result);
      } else {
        jsonResponse(res, 200, result);
      }
      return;
    }

    if (path[0] === 'notifications' && path.length === 1 && req.method === 'GET') {
      // Force userId from header, parse isRead as boolean
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
      return;
    }

    if (path[0] === 'notifications' && path.length === 2 && path[1] === 'read-all' && req.method === 'POST') {
      // Use userId from header, ignore body
      const result = markAllAsRead(userId);
      if ('success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode || 400, result);
      } else {
        jsonResponse(res, 200, result);
      }
      return;
    }

    // GET /notifications/:id — must verify ownership
    if (path[0] === 'notifications' && path.length === 2 && path[1] !== 'read-all' && req.method === 'GET') {
      const notification = getNotificationById(path[1], userId);
      if ('success' in notification && !notification.success) {
        jsonResponse(res, (notification as any).statusCode, notification);
        return;
      }
      jsonResponse(res, 200, notification);
      return;
    }

    // POST /notifications/:id (mark as read) — must verify ownership
    if (path[0] === 'notifications' && path.length === 2 && path[1] !== 'read-all' && req.method === 'POST') {
      const result = markAsRead(path[1], userId);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, result);
      } else {
        jsonResponse(res, 200, { success: true });
      }
      return;
    }

    // DELETE /notifications/:id — must verify ownership
    if (path[0] === 'notifications' && path.length === 2 && req.method === 'DELETE') {
      const result = deleteNotification(path[1], userId);
      if (typeof result === 'object' && 'success' in result && !result.success) {
        jsonResponse(res, (result as any).statusCode, result);
      } else {
        jsonResponse(res, 200, { success: true });
      }
      return;
    }

    sendError(res, 404, 'Not Found');
  } catch (e: any) {
    if (e.message === 'Request body too large') {
      sendError(res, 413, '请求体过大，最大支持 100KB');
    } else {
      sendError(res, 500, '服务器错误');
    }
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`服务运行在 http://localhost:${PORT}`);
});

export default server;