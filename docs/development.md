# 体重记录与通知中心开发文档

## 1. 项目概述

本项目包含一个 TypeScript 后端服务和一个 Flutter 移动端应用。后端服务位于 `tizhongji-service`，客户端位于 `tizhongji-app`。当前核心能力包括：

- 用户通知中心
- 早晚体重记录
- 体重趋势统计
- Flutter 客户端展示与本地设置管理

后端基于 Node.js 原生 HTTP 服务实现，使用 SQLite 作为本地持久化存储。客户端通过 HTTP + JSON 调用后端 API，并在请求头中携带 `X-User-Id` 作为当前用户身份。Flutter 客户端使用 `shared_preferences` 保存用户设置。

项目的体重记录业务目标是帮助用户持续记录每日早晚体重变化，并通过曲线图展示趋势，辅助用户观察体重管理效果。目标用户包括正在减脂、增肌或维持体重的人群、需要长期监测体重变化的用户，以及希望区分早晚体重差异并观察趋势的人群。

## 2. 技术栈与运行环境

后端技术栈：

- Node.js >= 18
- TypeScript
- better-sqlite3
- Jest
- uuid

客户端技术栈：

- Flutter
- Dart
- http
- fl_chart
- shared_preferences
- intl

`tizhongji-service/package.json` 中的项目元信息和脚本如下：

```json
{
  "name": "user-notification-center",
  "version": "1.0.0",
  "description": "用户通知中心",
  "main": "dist/notification.js",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "test:unit": "jest tests/"
  }
}
```

后端依赖版本：

- `better-sqlite3`: `^11.0.0`
- `uuid`: `^9.0.0`

后端开发依赖版本：

- `@types/better-sqlite3`: `^7.6.0`
- `@types/jest`: `^29.5.0`
- `@types/node`: `^20.0.0`
- `@types/uuid`: `^9.0.0`
- `jest`: `^29.7.0`
- `ts-jest`: `^29.1.0`
- `typescript`: `^5.3.0`

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

测试：

```bash
npm test
```

单元测试：

```bash
npm run test:unit
```

后端默认监听：

```text
http://localhost:3000
```

Flutter 客户端 API 地址配置在：

```text
tizhongji-app/lib/config/api_config.dart
```

当前值为：

```dart
class ApiConfig {
  static const String baseUrl = 'http://localhost:3000';
}
```

## 3. 系统架构

整体调用链：

```text
Flutter App
  |
  | HTTP + JSON
  | Header: X-User-Id
  v
Node.js HTTP Server
  |
  | Service Modules
  | - notification.ts
  | - weight-record.ts
  v
SQLite Database
  |
  | Tables
  | - notifications
  | - weight_records
```

后端模块：

- `src/server.ts`：HTTP 服务入口、路由分发、CORS、身份校验、错误响应。
- `src/db.ts`：SQLite 连接管理、表结构初始化、索引初始化。
- `src/notification.ts`：通知创建、查询、标记已读、删除。
- `src/weight-record.ts`：体重记录新增/更新、查询、删除、统计。
- `src/types.ts`：核心 TypeScript 类型定义。
- `src/router.ts`：通用 Router 类，目前主服务未直接使用。

客户端模块：

- `tizhongji-app/lib/services/weight_api_service.dart`：体重 API 客户端。
- `tizhongji-app/lib/services/settings_service.dart`：本地用户设置存取。
- `tizhongji-app/lib/models/weight_record.dart`：体重记录与统计模型。
- `tizhongji-app/lib/models/user_settings.dart`：用户偏好设置模型。
- `tizhongji-app/lib/config/api_config.dart`：后端地址配置。

`src/server.ts` 当前使用手写路径分发，不使用 `src/router.ts` 的通用 `Router` 类。`src/router.ts` 支持 `get`、`post`、`put`、`delete` 注册路由，支持 `:param` 路径参数和 query 解析，但当前主服务入口未接入。

## 4. 项目结构与职责边界

服务端核心目录：

```text
tizhongji-service/
  src/
    db.ts
    notification.ts
    router.ts
    server.ts
    types.ts
    weight-record.ts
  tests/
    notification.test.ts
    weight-record.test.ts
    test-report.md
  docs/
    development.md
    feature-doc.md
    fix-plan.md
    fix-stats-field-names.md
    technical-architecture.md
    weight-tracker.md
  package.json
  package-lock.json
  tsconfig.json
  jest.config.js
  notifications.db
  notifications.db-shm
  notifications.db-wal
```

客户端核心目录：

```text
tizhongji-app/
  lib/
    config/
      api_config.dart
    models/
      user_settings.dart
      weight_record.dart
    pages/
      home_page.dart
      history_page.dart
      record_page.dart
      settings_page.dart
    services/
      settings_service.dart
      weight_api_service.dart
    main.dart
  pubspec.yaml
```

职责划分：

- `server.ts` 负责 HTTP 协议层、认证入口、CORS Header、请求体解析、路由匹配和统一错误响应。
- `weight-record.ts` 负责体重记录业务校验、`userId + date` upsert、分页查询、对象级授权读取、对象级授权删除、统计计算。
- `notification.ts` 负责通知业务校验、分页查询、软删除、已读状态更新和对象级授权。
- `db.ts` 负责 SQLite 单例连接、`journal_mode = WAL`、数据库初始化和关闭。
- `types.ts` 负责接口与业务对象类型。
- Flutter `WeightApiService` 负责统一注入 `Content-Type: application/json` 和 `X-User-Id` Header。

## 5. 数据模型与数据库设计

SQLite 数据库文件位于服务端项目根目录：

```text
tizhongji-service/notifications.db
```

连接路径在 `src/db.ts` 中定义为：

```ts
const DB_PATH = path.join(__dirname, '..', 'notifications.db');
```

数据库打开后执行：

```ts
db.pragma('journal_mode = WAL');
```

### 5.1 notifications

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('system', 'order', 'message', 'campaign')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type ON notifications(user_id, type);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, deleted);
```

TypeScript 类型：

```ts
export type NotificationType = 'system' | 'order' | 'message' | 'campaign';
export type Priority = 'low' | 'normal' | 'high';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  isRead: boolean;
  priority: Priority;
  createdAt: string;
  readAt?: string;
  deleted?: boolean;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  priority?: Priority;
}

export interface NotificationListQuery {
  userId: string;
  type?: NotificationType;
  isRead?: boolean;
  page?: number;
  pageSize?: number;
}
```

### 5.2 weight_records（v2 需求变更）

> **需求变更（v2）**：早上和晚上记录拆分为独立记录，同一天可存在早晨记录和晚上记录各一条，若二者同时存在则计算差值。

```sql
CREATE TABLE IF NOT EXISTS weight_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  period TEXT NOT NULL CHECK(period IN ('morning', 'evening')),
  weight REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, date, period)
);

CREATE INDEX IF NOT EXISTS idx_weight_records_user_date ON weight_records(user_id, date);
```

**注意**：v2 需求实施后，`weight_records` 表将使用 `period` + `weight` 单字段设计，原有的 `morning_weight` + `evening_weight` 共存方案废弃。请参考 `docs/weight-tracker.md` 中的原始设计说明。

TypeScript 类型（v2）：

```ts
export interface WeightRecord {
  id: string;
  userId: string;
  date: string;        // YYYY-MM-DD
  period: 'morning' | 'evening';
  weight: number;      // kg，精确到 0.1
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WeightRecordWithDiff extends WeightRecord {
  weightDiff?: number; // eveningWeight - morningWeight，仅当同日存在早晚两条记录时返回
}

export interface CreateWeightRecordInput {
  userId: string;
  date: string;
  period: 'morning' | 'evening';
  weight: number;
  note?: string;
}

export interface WeightRecordQuery {
  userId: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface DailyWeightRecord {
  date: string;
  morningRecord?: WeightRecord;
  eveningRecord?: WeightRecord;
  weightDiff?: number; // eveningRecord.weight - morningRecord.weight，保留 1 位小数
}

export interface WeightStats {
  avgMorningWeight: number | null;
  avgEveningWeight: number | null;
  minWeight: number | null;
  maxWeight: number | null;
  change: number | null;
  avgWeightDiff: number | null;  // v2 新增：早晚体重差值平均值
}
```

### 5.2.1 v2 API 设计变更

#### 创建体重记录（v2）

```
POST /weight-records
```

请求体：

```json
{
  "date": "2026-05-03",
  "period": "morning",
  "weight": 70.2,
  "note": "空腹"
}
```

- `period` 必填，可选 `morning` 或 `evening`
- 同一用户同一天同一时段只能有一条记录
- 已存在该时段记录时执行更新

响应（v2）：

```json
{
  "id": "uuid",
  "userId": "default_user",
  "date": "2026-05-03",
  "period": "morning",
  "weight": 70.2,
  "note": "空腹",
  "createdAt": "2026-05-03T00:00:00.000Z",
  "updatedAt": "2026-05-03T00:00:00.000Z"
}
```

#### 查询体重记录列表（v2）

```
GET /weight-records?startDate=2026-05-01&endDate=2026-05-03&page=1&pageSize=20
```

响应（v2）：

```json
{
  "items": [
    {
      "date": "2026-05-03",
      "morningRecord": { "id": "uuid1", "period": "morning", "weight": 70.2, "note": "空腹" },
      "eveningRecord": { "id": "uuid2", "period": "evening", "weight": 71.0, "note": "晚饭后" },
      "weightDiff": 0.8
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

- `weightDiff = eveningWeight - morningWeight`，保留 1 位小数
- 若某日只有早或只有晚记录，`weightDiff` 为 `null`
- 列表按日期 `ASC` 排序

#### 新增：获取每日体重对比（v2）

```
GET /weight-records/daily?startDate=2026-05-01&endDate=2026-05-03
```

专门用于获取按日期聚合的早晚体重对比数据：

响应：

```json
{
  "items": [
    {
      "date": "2026-05-03",
      "morningRecord": { "id": "...", "period": "morning", "weight": 70.2, "note": "空腹" },
      "eveningRecord": { "id": "...", "period": "evening", "weight": 71.0, "note": "晚饭后" },
      "weightDiff": 0.8
    },
    {
      "date": "2026-05-02",
      "morningRecord": { "id": "...", "period": "morning", "weight": 70.0 },
      "eveningRecord": null,
      "weightDiff": null
    }
  ],
  "total": 2
}
```

#### 统计接口变更（v2）

```
GET /weight-records/stats?startDate=2026-05-01&endDate=2026-05-03
```

响应新增 `avgWeightDiff` 字段：

```json
{
  "avgMorningWeight": 70.1,
  "avgEveningWeight": 70.8,
  "minWeight": 69.9,
  "maxWeight": 71.2,
  "change": 0.8,
  "avgWeightDiff": 0.7
}
```

- `avgWeightDiff`：统计日期范围内所有有效体重差值的平均值，仅当同日同时存在早晚记录时计入
```

分页通用类型：

```ts
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  statusCode: number;
}
```

## 6. API 设计

> **说明**：本节描述当前实现的 API。v2 需求（早上/晚上拆分为独立记录）变更正在实施中，请参见第 5.2 节的 v2 设计说明。

所有业务 API 都要求请求头：

```http
X-User-Id: default_user
Content-Type: application/json
```

`X-User-Id` 只允许 `a-zA-Z0-9_-`，长度 1 到 64。服务端强制以 Header 中的 `X-User-Id` 为准，忽略 body 或 query 中传入的 `userId`。

缺少用户身份时返回：

```json
{
  "success": false,
  "error": "未提供用户身份标识，请使用 X-User-Id Header"
}
```

状态码为 `401`。

用户身份格式非法时返回：

```json
{
  "success": false,
  "error": "无效的用户身份标识格式"
}
```

状态码为 `400`。

### 6.1 创建或更新体重记录（v2 待实施）

> 当前实现使用 `morningWeight`/`eveningWeight` 共存设计，v2 需求将其拆分为 `period` + `weight` 独立记录。

```http
POST /weight-records
```

请求体（v2）：

```json
{
  "date": "2026-05-03",
  "period": "morning",
  "weight": 70.2,
  "note": "空腹"
}
```

行为：

- 后端以 `X-User-Id` 为准，忽略 body 中的 `userId`。
- `period` 必填，可选 `morning` 或 `evening`。
- 同一用户同一天同一时段只能有一条记录。
- 已存在该时段记录时执行更新，不存在时创建。

响应（v2）：

```json
{
  "id": "uuid",
  "userId": "default_user",
  "date": "2026-05-03",
  "period": "morning",
  "weight": 70.2,
  "note": "空腹",
  "createdAt": "2026-05-03T00:00:00.000Z",
  "updatedAt": "2026-05-03T00:00:00.000Z"
}
```

### 6.2 查询体重记录列表（v2 待实施）

> 当前实现返回 `WeightRecord[]`，v2 需求改为返回按日期聚合的 `DailyWeightRecord[]`，并附带 `weightDiff`。

```http
GET /weight-records?startDate=2026-05-01&endDate=2026-05-03&page=1&pageSize=20
```

行为（v2）：

- 后端以 `X-User-Id` 为准，忽略 query 中的 `userId`。
- 查询同日期的早、晚两条记录，按日期聚合为 `DailyWeightRecord`。
- `weightDiff = eveningWeight - morningWeight`，保留 1 位小数；若缺早或缺晚则为 `null`。
- 按 `date ASC` 排序。
- `page` 默认值为 `1`，最小为 `1`。
- `pageSize` 默认值为 `20`，最小为 `1`，最大为 `100`。

响应（v2）：

```json
{
  "items": [
    {
      "date": "2026-05-03",
      "morningRecord": { "id": "uuid1", "period": "morning", "weight": 70.2, "note": "空腹" },
      "eveningRecord": { "id": "uuid2", "period": "evening", "weight": 71.0, "note": "晚饭后" },
      "weightDiff": 0.8
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

### 6.3 查询体重统计（v2 待实施）

> v2 需求在统计响应中新增 `avgWeightDiff` 字段。

```http
GET /weight-records/stats?startDate=2026-05-01&endDate=2026-05-03
```

响应（v2）：

```json
{
  "avgMorningWeight": 70.1,
  "avgEveningWeight": 70.8,
  "minWeight": 69.9,
  "maxWeight": 71.2,
  "change": 0.8,
  "avgWeightDiff": 0.7
}
```

空数据响应（v2）：

```json
{
  "avgMorningWeight": null,
  "avgEveningWeight": null,
  "minWeight": null,
  "maxWeight": null,
  "change": null,
  "avgWeightDiff": null
}
```

统计接口使用无 `LIMIT/OFFSET` 的全量查询，不受分页影响。`avgWeightDiff` 仅统计同日期同时存在早晚记录的差值。

### 6.4 获取单条体重记录

```http
GET /weight-records/:id
```

行为：

- 必须携带 `X-User-Id`。
- `getWeightRecordById(id, userId)` 使用 `id = ? AND user_id = ?` 查询。
- 记录不存在或无权访问时返回 `404`。

错误响应：

```json
{
  "success": false,
  "error": "体重记录不存在或无权访问",
  "statusCode": 404
}
```

### 6.5 删除体重记录

```http
DELETE /weight-records/:id
```

成功响应：

```json
{
  "success": true
}
```

行为：

- `deleteWeightRecord(id, userId)` 使用 `DELETE FROM weight_records WHERE id = ? AND user_id = ?`。
- `changes === 0` 时返回 `404 体重记录不存在或无权访问`。

### 6.6 创建通知

```http
POST /notifications
```

请求体：

```json
{
  "type": "system",
  "title": "系统通知",
  "content": "欢迎使用",
  "priority": "normal"
}
```

行为：

- 后端以 `X-User-Id` 为准，忽略 body 中的 `userId`。
- `isRead` 初始为 `false`。
- `priority` 未传时默认为 `normal`。

### 6.7 查询通知列表

```http
GET /notifications?type=system&isRead=false&page=1&pageSize=20
```

行为：

- 后端以 `X-User-Id` 为准。
- 支持 `type`、`isRead`、`page`、`pageSize`。
- `isRead` 仅当 query 值为 `true` 或 `false` 时解析为布尔值。
- 只查询 `deleted = 0` 的通知。
- 按 `created_at DESC` 排序。
- `page` 默认值为 `1`，最小为 `1`。
- `pageSize` 默认值为 `20`，最小为 `1`，最大为 `100`。

### 6.8 获取单条通知

```http
GET /notifications/:id
```

行为：

- `getNotificationById(notificationId, userId)` 使用 `id = ? AND user_id = ? AND deleted = 0` 查询。
- 通知不存在或无权访问时返回 `404`。

错误响应：

```json
{
  "success": false,
  "error": "通知不存在或无权访问",
  "statusCode": 404
}
```

### 6.9 标记通知已读

```http
POST /notifications/:id
```

成功响应：

```json
{
  "success": true
}
```

行为：

- `markAsRead(notificationId, userId)` 使用 `UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ? AND user_id = ? AND deleted = 0`。
- 通知不存在、已删除或无权访问时返回 `404 通知不存在或无权访问`。

### 6.10 标记全部通知已读

```http
POST /notifications/read-all
```

响应：

```json
{
  "success": true,
  "count": 3
}
```

行为：

- 使用 Header 中的 `userId`，忽略 body。
- `markAllAsRead(userId)` 只更新当前用户自己的 `is_read = 0 AND deleted = 0` 通知。
- SQL 为 `UPDATE notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0 AND deleted = 0`。

### 6.11 删除通知

```http
DELETE /notifications/:id
```

成功响应：

```json
{
  "success": true
}
```

行为：

- 默认软删除：`UPDATE notifications SET deleted = 1 WHERE id = ? AND user_id = ? AND deleted = 0`。
- `deleteNotification(notificationId, userId, hardDelete = false)` 支持硬删除分支：`DELETE FROM notifications WHERE id = ? AND user_id = ? AND deleted = 0`。
- 通知不存在、已删除或无权访问时返回 `404 通知不存在或无权访问`。

## 7. 业务规则与校验

### 7.1 体重记录规则（v2）

> v2 需求将早上/晚上拆分为独立记录，字段定义变更如下：

体重记录实体 `WeightRecord` 字段规则：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string (UUID) | 是 | 全局唯一标识 |
| `userId` | string | 是 | 用户ID |
| `date` | string | 是 | 记录日期，格式 YYYY-MM-DD |
| `period` | string | 是 | 时段：`morning` 或 `evening` |
| `weight` | number | 是 | 体重（kg），精确到0.1 |
| `note` | string | 否 | 备注（如"空腹"），最多200字符 |
| `createdAt` | timestamp | 是 | 创建时间 |
| `updatedAt` | timestamp | 是 | 更新时间 |

约束规则（v2）：

- 同一用户同一天同一时段只能有一条记录，以 `date + userId + period` 唯一。
- 同一用户同一天可存在早晨和晚上记录各一条。
- 若某日同时存在早晚记录，`weightDiff = eveningWeight - morningWeight`。
- `date` 必须是严格有效的 `YYYY-MM-DD`。
- `date` 不能超过当前日期。
- 当前日期使用本地时间生成，不使用 `toISOString().split('T')[0]`，避免中国时区 `00:00~00:59` 被误判为前一天。
- 体重需在 `20.0~300.0 kg` 范围内。
- `NaN`、`Infinity`、`-Infinity` 会被 `Number.isFinite()` 拒绝。
- `note` 最多 200 字符，保存时会执行 `trim()`。

体重记录错误信息（v2）：

| 场景 | HTTP状态码 | 错误信息 |
|---|---:|---|
| 体重超出范围 | 400 | `体重需在 20.0~300.0 kg 范围内` |
| 体重均未填 | 400 | `体重为必填项` |
| 日期超过今天 | 400 | `日期不能超过当前日期` |
| 日期格式错误 | 400 | `日期格式不正确，应为 YYYY-MM-DD` |
| `period` 非法 | 400 | `period 必须是 morning 或 evening` |
| `startDate` 格式错误 | 400 | `startDate 格式不正确，应为 YYYY-MM-DD` |
| `endDate` 格式错误 | 400 | `endDate 格式不正确，应为 YYYY-MM-DD` |
| `startDate` 晚于 `endDate` | 400 | `startDate 不能晚于 endDate` |
| 备注过长 | 400 | `备注最多200字符` |
| 记录不存在或无权访问 | 404 | `体重记录不存在或无权访问` |
| `userId` 缺失 | 400 | `userId 为必填项` |

### 7.2 体重统计规则（v2）

统计字段（v2 新增 `avgWeightDiff`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `avgMorningWeight` | number \| null | 平均早体重 |
| `avgEveningWeight` | number \| null | 平均晚体重 |
| `minWeight` | number \| null | 最低体重 |
| `maxWeight` | number \| null | 最高体重 |
| `change` | number \| null | 体重变化量 |
| `avgWeightDiff` | number \| null | v2 新增：早晚体重差值平均值 |

计算规则（v2）：

- 所有统计结果保留 1 位小数。
- 平均值只统计非空值，缺失值不当作 0。
- 最低/最高体重从所有体重记录中取。
- `change` 计算：按日期升序，第一条记录取该日期唯一体重（早权重）或（晚权重），最后一条同理。
- v2 中 `change` 计算逻辑调整：取第一条记录体重减去最后一条记录体重，`change = Math.round((lastWeight - firstWeight) * 10) / 10`。
- `avgWeightDiff`：收集所有同日期同时存在早晚记录的差值，计算其平均值；若某日只存在一个时段则不计入；保留 1 位小数。
- 空数据返回所有字段为 `null`。

### 7.3 通知规则

通知规则：

- `type` 可选值：`system`、`order`、`message`、`campaign`。
- `priority` 可选值：`low`、`normal`、`high`。
- `priority` 未传时默认为 `normal`。
- 标题最多 100 字符，保存时会执行 `trim()`。
- 内容最多 2000 字符，保存时会执行 `trim()`。
- 删除为软删除，设置 `deleted = 1`。
- `markAsRead` 会设置 `is_read = 1`，并写入 `read_at` ISO 时间。
- `markAllAsRead` 仅影响指定用户自己的未读、未删除通知。

通知错误信息：

| 场景 | HTTP状态码 | 错误信息 |
|---|---:|---|
| `userId` 缺失或格式不正确 | 400 | `userId 为必填项，格式不正确` |
| 标题缺失或超过 100 字符 | 400 | `标题长度不能超过100字符` |
| 内容缺失或超过 2000 字符 | 400 | `内容长度不能超过2000字符` |
| `type` 非法 | 400 | `type 必须是以下值之一: system, order, message, campaign` |
| `priority` 非法 | 400 | `priority 必须是以下值之一: low, normal, high` |
| 批量创建超过 100 条 | 400 | `批量创建最多一次100条` |
| 通知不存在或无权访问 | 404 | `通知不存在或无权访问` |

## 8. 安全、认证与跨域

### 8.1 身份认证

当前认证方案是轻量 Header 方案：

```http
X-User-Id: user-001
```

服务端认证规则：

- 所有业务路由进入前必须存在用户身份。
- 缺少 `X-User-Id` 返回 `401`。
- `X-User-Id` 必须匹配 `^[a-zA-Z0-9_-]{1,64}$`。
- 非法 `X-User-Id` 返回 `400`。
- 服务端只信任 Header 中的用户身份。
- 服务端忽略 body 或 query 中传入的 `userId`。

生产环境注意：`X-User-Id` 当前无服务端签名验证，客户端可伪造任意身份。生产环境应替换为 JWT、Session 或网关签发的可信身份。

### 8.2 对象级授权

体重记录：

- `getWeightRecordById(id, userId)` 查询条件包含 `id = ? AND user_id = ?`。
- `deleteWeightRecord(id, userId)` 删除条件包含 `id = ? AND user_id = ?`。
- 用户 B 读取或删除用户 A 的记录会返回 `404 体重记录不存在或无权访问`，且不会改变用户 A 数据。

通知：

- `getNotificationById(notificationId, userId)` 查询条件包含 `id = ? AND user_id = ? AND deleted = 0`。
- `markAsRead(notificationId, userId)` 更新条件包含 `id = ? AND user_id = ? AND deleted = 0`。
- `deleteNotification(notificationId, userId)` 删除条件包含 `id = ? AND user_id = ? AND deleted = 0`。
- 用户 B 读取、标记已读或删除用户 A 的通知会返回 `404 通知不存在或无权访问`，且不会改变用户 A 数据。
- `markAllAsRead(userId)` 仅影响当前用户。

### 8.3 CORS

当前 CORS 白名单：

```ts
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:8080',
]);
```

响应 Header：

```http
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-User-Id
Access-Control-Max-Age: 86400
```

当请求 `Origin` 命中白名单时，服务端返回：

```http
Access-Control-Allow-Origin: <origin>
```

`OPTIONS` 预检请求返回 `204`。响应中不再使用 `Access-Control-Allow-Origin: *`。

生产环境注意：CORS 当前仅限 `http://localhost:3000` 和 `http://localhost:8080`，生产部署前需要配置正式前端域名。

### 8.4 请求体与错误处理

请求体最大限制：

```ts
const MAX_BODY_SIZE = 1024 * 100; // 100KB limit
```

请求体超过 100KB 时返回：

```json
{
  "success": false,
  "error": "请求体过大，最大支持 100KB"
}
```

状态码为 `413`。

JSON 解析失败时当前会进入通用 catch 分支并返回：

```json
{
  "success": false,
  "error": "服务器错误"
}
```

状态码为 `500`。

未知路由返回：

```json
{
  "success": false,
  "error": "Not Found"
}
```

状态码为 `404`。

## 9. Flutter 客户端集成

Flutter 体重接口客户端位于：

```text
tizhongji-app/lib/services/weight_api_service.dart
```

统一 Header：

```dart
Map<String, String> _headers(String userId) => {
  'Content-Type': 'application/json',
  'X-User-Id': userId,
};
```

客户端方法：

- `getWeightRecords({ required String userId, String? startDate, String? endDate, int page = 1, int pageSize = 100 })`
- `createWeightRecord({ required String userId, required String date, double? morningWeight, double? eveningWeight, String? note })`
- `getWeightStats({ required String userId, String? startDate, String? endDate })`
- `deleteWeightRecord(String id, String userId)`

`getWeightRecords` 调用：

```text
GET <baseUrl>/weight-records
```

query 参数：

- `startDate`
- `endDate`
- `page`
- `pageSize`

`createWeightRecord` 调用：

```text
POST <baseUrl>/weight-records
```

body 中不发送 `userId`，只发送：

- `date`
- `morningWeight`
- `eveningWeight`
- `note`

`getWeightStats` 调用：

```text
GET <baseUrl>/weight-records/stats
```

`deleteWeightRecord` 调用：

```text
DELETE <baseUrl>/weight-records/:id
```

客户端模型 `WeightRecord` 字段：

- `id`
- `userId`
- `date`
- `morningWeight`
- `eveningWeight`
- `note`
- `createdAt`
- `updatedAt`

客户端模型 `WeightStats` 字段：

- `avgMorningWeight`
- `avgEveningWeight`
- `minWeight`
- `maxWeight`
- `change`

Flutter 需求中的 UI 行为：

- 日期选择器默认当天，支持选择历史日期。
- 早体重输入框为数字输入，单位 kg，保留 1 位小数。
- 晚体重输入框为数字输入，单位 kg，保留 1 位小数。
- 备注输入框为可选文本输入。
- 保存按钮提交记录。
- 曲线图类型为折线图。
- X 轴为日期，按时间顺序排列。
- Y 轴为体重（kg），自动适配数据范围。
- 橙色线表示早体重。
- 紫色线表示晚体重。
- 时间范围筛选支持「近7天」「近30天」「近90天」「全部」。
- 点击数据点显示详情气泡：日期、早体重、晚体重、备注。
- 长按数据点可编辑该条记录。
- 空状态提示文案为「记录第一天的体重吧」。
- 数据统计区显示平均早体重、平均晚体重、最低体重、最高体重、体重变化量。

产品页面结构：

| 页面 | 主要模块 |
|---|---|
| 首页 | 当前体重卡片、今日记录入口、最近趋势图、最近记录列表 |
| 记录页 | 日期选择、早晚切换、体重输入、备注、保存 |
| 趋势页 | 体重曲线图、时间范围筛选、早晚/对比切换、数据点详情 |
| 历史页 | 历史记录列表、日期筛选、编辑/删除操作 |

## 10. 测试、验收与生产前注意事项

### 10.1 当前测试结果

`tests/test-report.md` 记录的第十轮测试结果：

```text
Test Suites: 2 passed, 2 total
Tests:       34 passed, 34 total
```

测试套件：

| 测试套件 | 用例数 | 结果 |
|---|---:|---|
| notification.test.ts | 12/12 | 通过 |
| weight-record.test.ts | 22/22 | 通过 |

TypeScript 编译检查：

```bash
npx tsc --noEmit
```

结果：无错误输出。

### 10.2 体重记录测试覆盖

| 用例编号 | 场景 | 预期结果 |
|---|---|---|
| WT-001 | 正常创建早体重记录 | 返回完整记录，包含 UUID |
| WT-002 | 填写早体重和晚体重 | 保存成功，两项均返回 |
| WT-003 | 早体重填写 15.0 kg | 返回 400 错误 |
| WT-004 | 早晚体重均不填 | 返回 400 错误 |
| WT-005 | 查询指定用户近7天记录 | 按日期升序返回记录列表 |
| WT-006 | 获取不存在的记录ID | 返回 404 错误 |
| WT-007 | 更新已存在的记录（同一日期） | 记录被覆盖，`updatedAt` 更新 |
| WT-008 | 删除体重记录后查询 | 记录不再出现 |
| WT-009 | 用户 B 无法读取用户 A 的体重记录 | 通过 |
| WT-010 | 用户 B 无法删除用户 A 的体重记录 | 通过 |
| WT-011 | `calculateWeightStats` 返回字段名与文档一致 | 通过 |
| WT-012 | 统计超过 20 条记录不受分页影响 | 通过 |
| WT-013 | 无效日期格式（2024-02-30、2024-13-01 等）被严格拒绝 | 通过 |
| WT-014 | NaN/Infinity 体重值被拒绝 | 通过 |

### 10.3 通知测试覆盖

| 用例编号 | 场景 | 预期结果 |
|---|---|---|
| TC-001 | 创建一条合法通知 | 返回完整通知对象，包含 UUID |
| TC-002 | 创建标题超过100字符的通知 | 返回 400 错误 |
| TC-003 | 查询某用户的通知列表 | 返回分页结果，按时间倒序 |
| TC-004 | 按 type 过滤通知 | 仅返回指定类型的通知 |
| TC-005 | 标记通知为已读 | `isRead = true`，`readAt` 记录时间 |
| TC-006 | 批量标记某用户所有未读通知为已读 | 返回成功，数量匹配 |
| TC-007 | 删除已存在通知 | 再次查询时不再出现 |
| TC-009 | 用户 B 无法读取用户 A 的通知 | 通过 |
| TC-010 | 用户 B 无法标记用户 A 的通知已读 | 通过 |
| TC-011 | 用户 B 无法删除用户 A 的通知 | 通过 |
| TC-012 | `markAllAsRead` 仅影响当前用户 | 通过 |

### 10.4 已修复问题

以下问题已在代码和测试中覆盖：

- 认证缺失：所有业务接口要求 `X-User-Id`。
- 数据隔离：跨用户读取、删除、标记已读均按 `userId` 授权。
- CORS 使用通配符 `*`：已改为白名单。
- `calculateWeightStats` 复用分页列表：已新增无 `LIMIT/OFFSET` 的统计查询。
- 统计字段名不一致：已统一为 `avgMorningWeight`、`avgEveningWeight`、`minWeight`、`maxWeight`、`change`。
- 日期格式验证不严格：已使用 Date 重建方式严格校验。
- 体重未检查 `NaN/Infinity`：已使用 `Number.isFinite()`。
- 午夜时区 Bug：已使用本地日期，修复中国时区 `00:00~00:59` 保存当日记录失败的问题。

### 10.5 验收标准

体重记录功能验收：

- 可成功新增、编辑、删除早晚体重记录。
- 同一天同一用户不会产生重复记录。
- 曲线图正确展示早晨、晚上及对比趋势。
- 支持按 7 天、30 天、90 天和自定义范围查看趋势。
- 历史记录与曲线图数据保持一致。
- 早晚体重至少填写一项。
- 体重范围限制为 `20.0~300.0 kg`。
- 备注最多 200 字符。
- `date` 不能超过当前日期。

通知功能验收：

- 可创建合法通知。
- 可按用户分页查询通知。
- 可按 `type` 和 `isRead` 过滤通知。
- 可获取单条通知。
- 可标记单条通知已读。
- 可标记当前用户全部未读通知为已读。
- 可软删除通知。
- 已删除通知不再出现在列表和详情中。
- 跨用户读取、标记已读和删除均失败。

### 10.6 生产前注意事项

测试报告中保留的生产部署前风险：

| 问题 | 级别 | 说明 |
|---|---|---|
| X-User-Id 无服务端签名验证 | CRITICAL | 客户端可伪造任意身份 |
| 无速率限制 | HIGH | 易遭暴力枚举 |
| 批量通知创建缺少 type 校验 | HIGH | 会触发数据库 500 而非 400 |
| CORS 仅限 localhost | HIGH | 生产环境无法访问 |
| Flutter 静默吞掉 API 错误 | HIGH | 用户无法感知错误 |

建议生产前完成：

- 将 `X-User-Id` 替换为 JWT、Session 或网关签发的可信身份。
- 增加速率限制和基础审计日志。
- 为生产域名配置 CORS 白名单。
- 修复 `createNotificationsBatch` 对 `type` 和 `priority` 的校验，使其与 `createNotification` 保持一致。
- 优化 Flutter 错误提示，避免只抛出泛化错误如 `获取体重记录失败`、`获取统计数据失败`、`删除失败`。

## 11. v2 需求变更：早晚记录拆分

### 变更说明

**需求来源**：用户反馈
**变更时间**：2026-05-03

**核心变更**：早上和晚上的体重记录拆分为独立记录，不再共存在同一条记录中。若同一天同时存在早、晚两条记录，则计算差值 `weightDiff = eveningWeight - morningWeight`。

### 数据模型变更

| 原字段 | v2 变更 |
|---|---|
| `morningWeight`, `eveningWeight` (同一记录) | 拆分为 `period` (`morning`/`evening`) + `weight` 单字段 |
| `UNIQUE(user_id, date)` | 变更为 `UNIQUE(user_id, date, period)` |
| 统计 `change` | 逻辑不变（按时间范围首尾体重计算），但需适应单 period 记录 |

### 数据库迁移建议

由于 `weight_records` 表结构发生根本性变化，建议：

1. 新增 `period` 列并迁移数据（将原有记录按 `morningWeight`/`eveningWeight` 拆分为两条）
2. 或保留旧表，新建 `weight_records_v2` 表，过渡期双写
3. 迁移完成后删除旧列

### v2 实施检查清单

- [ ] 数据库表结构调整（`period` 字段、`weight` 单字段、`UNIQUE(user_id, date, period)`）
- [ ] API 请求体/响应体字段变更
- [ ] 列表查询按日期聚合逻辑（含 `weightDiff` 计算）
- [ ] 统计接口新增 `avgWeightDiff`
- [ ] Flutter 客户端模型字段适配
- [ ] 曲线图同时展示早/晚两条线（`period` 区分）
- [ ] 数据迁移脚本（如有必要）
- [ ] 旧单元测试更新 + 新增 v2 用例
