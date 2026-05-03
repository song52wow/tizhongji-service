import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import type {
  Notification,
  CreateNotificationInput,
  NotificationListQuery,
  PaginatedResult,
  NotificationType,
  Priority,
  ErrorResponse,
} from './types';

const VALID_TYPES: NotificationType[] = ['system', 'order', 'message', 'campaign'];
const VALID_PRIORITIES: Priority[] = ['low', 'normal', 'high'];
const MAX_TITLE_LENGTH = 100;
const MAX_CONTENT_LENGTH = 2000;

function toNotification(row: Record<string, unknown>): Notification {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    type: row['type'] as NotificationType,
    title: row['title'] as string,
    content: row['content'] as string,
    isRead: (row['is_read'] as number) === 1,
    priority: row['priority'] as Priority,
    createdAt: row['created_at'] as string,
    readAt: row['read_at'] as string | undefined,
    deleted: (row['deleted'] as number) === 1,
  };
}

export function createNotification(input: CreateNotificationInput): Notification | ErrorResponse {
  if (!input.userId || typeof input.userId !== 'string' || input.userId.trim() === '') {
    return { success: false, error: 'userId 为必填项，格式不正确', statusCode: 400 };
  }
  if (!input.title || typeof input.title !== 'string' || input.title.length > MAX_TITLE_LENGTH) {
    return { success: false, error: '标题长度不能超过100字符', statusCode: 400 };
  }
  if (!input.content || typeof input.content !== 'string' || input.content.length > MAX_CONTENT_LENGTH) {
    return { success: false, error: '内容长度不能超过2000字符', statusCode: 400 };
  }
  if (!VALID_TYPES.includes(input.type)) {
    return { success: false, error: `type 必须是以下值之一: ${VALID_TYPES.join(', ')}`, statusCode: 400 };
  }
  if (input.priority && !VALID_PRIORITIES.includes(input.priority)) {
    return { success: false, error: `priority 必须是以下值之一: ${VALID_PRIORITIES.join(', ')}`, statusCode: 400 };
  }

  const db = getDb();
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const priority = input.priority || 'normal';

  const stmt = db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, content, is_read, priority, created_at, deleted)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0)
  `);
  stmt.run(id, input.userId.trim(), input.type, input.title.trim(), input.content.trim(), priority, createdAt);

  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Record<string, unknown>;
  return toNotification(row);
}

export function createNotificationsBatch(inputs: CreateNotificationInput[]): Notification[] | ErrorResponse {
  if (inputs.length > 100) {
    return { success: false, error: '批量创建最多一次100条', statusCode: 400 };
  }
  const results: Notification[] = [];
  const db = getDb();
  const createdAt = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, content, is_read, priority, created_at, deleted)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0)
  `);

  const insertMany = db.transaction((items: CreateNotificationInput[]) => {
    for (const input of items) {
      if (!input.userId || typeof input.userId !== 'string' || input.userId.trim() === '') {
        throw { success: false, error: 'userId 为必填项，格式不正确', statusCode: 400 };
      }
      if (!input.title || input.title.length > MAX_TITLE_LENGTH) {
        throw { success: false, error: '标题长度不能超过100字符', statusCode: 400 };
      }
      if (!input.content || input.content.length > MAX_CONTENT_LENGTH) {
        throw { success: false, error: '内容长度不能超过2000字符', statusCode: 400 };
      }
      const id = uuidv4();
      const priority = input.priority || 'normal';
      insertStmt.run(id, input.userId.trim(), input.type, input.title.trim(), input.content.trim(), priority, createdAt);
      const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Record<string, unknown>;
      results.push(toNotification(row));
    }
  });

  try {
    insertMany(inputs);
  } catch (e) {
    return e as ErrorResponse;
  }

  return results;
}

export function listNotifications(query: NotificationListQuery): PaginatedResult<Notification> | ErrorResponse {
  if (!query.userId || typeof query.userId !== 'string' || query.userId.trim() === '') {
    return { success: false, error: 'userId 为必填项，格式不正确', statusCode: 400 };
  }

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const db = getDb();
  const conditions: string[] = ['deleted = 0', 'user_id = ?'];
  const params: (string | number)[] = [query.userId.trim()];

  if (query.type) {
    conditions.push('type = ?');
    params.push(query.type);
  }

  if (query.isRead !== undefined) {
    conditions.push('is_read = ?');
    params.push(query.isRead ? 1 : 0);
  }

  const whereClause = conditions.join(' AND ');
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM notifications WHERE ${whereClause}`);
  const total = (countStmt.get(...params) as { count: number }).count;

  const selectStmt = db.prepare(
    `SELECT * FROM notifications WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  );
  const rows = selectStmt.all(...params, pageSize, offset) as Record<string, unknown>[];
  const items = rows.map(toNotification);

  return { items, total, page, pageSize };
}

export function markAsRead(notificationId: string, userId: string): boolean | ErrorResponse {
  const db = getDb();
  const readAt = new Date().toISOString();
  const result = db.prepare(
    'UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ? AND user_id = ? AND deleted = 0'
  ).run(readAt, notificationId, userId.trim());
  if (result.changes === 0) {
    return { success: false, error: '通知不存在或无权访问', statusCode: 404 };
  }
  return true;
}

export function markAllAsRead(userId: string): { success: boolean; count: number } | ErrorResponse {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return { success: false, error: 'userId 为必填项，格式不正确', statusCode: 400 };
  }
  const db = getDb();
  const readAt = new Date().toISOString();
  const result = db.prepare(
    'UPDATE notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0 AND deleted = 0'
  ).run(readAt, userId.trim());
  return { success: true, count: result.changes };
}

export function deleteNotification(notificationId: string, userId: string, hardDelete = false): boolean | ErrorResponse {
  const db = getDb();
  const sql = hardDelete
    ? 'DELETE FROM notifications WHERE id = ? AND user_id = ? AND deleted = 0'
    : 'UPDATE notifications SET deleted = 1 WHERE id = ? AND user_id = ? AND deleted = 0';
  const result = db.prepare(sql).run(notificationId, userId.trim());
  if (result.changes === 0) {
    return { success: false, error: '通知不存在或无权访问', statusCode: 404 };
  }
  return true;
}

export function getNotificationById(notificationId: string, userId: string): Notification | ErrorResponse {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM notifications WHERE id = ? AND user_id = ? AND deleted = 0'
  ).get(notificationId, userId.trim()) as Record<string, unknown> | undefined;
  if (!row) {
    return { success: false, error: '通知不存在或无权访问', statusCode: 404 };
  }
  return toNotification(row);
}