# 项目技术文档

## 1. 项目概述

本项目包含一个 TypeScript 后端服务和一个 Flutter 移动端应用，核心功能包括：

- 用户通知中心
- 早晚体重记录
- 体重趋势统计
- Flutter 客户端展示与本地设置管理

后端基于 Node.js 原生 HTTP 服务实现，使用 SQLite 作为本地持久化存储；客户端通过 HTTP API 与后端交互，并使用 `shared_preferences` 保存用户设置。

## 2. 技术栈

后端：

- Node.js
- TypeScript
- better-sqlite3
- Jest
- uuid

客户端：

- Flutter
- Dart
- http
- fl_chart
- shared_preferences
- intl

## 3. 技术架构

```
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

### 后端模块

- `src/server.ts`：HTTP 服务入口、路由分发、CORS、身份校验、错误响应。
- `src/db.ts`：SQLite 连接管理、表结构初始化、索引初始化。
- `src/notification.ts`：通知创建、查询、标记已读、删除。
- `src/weight-record.ts`：体重记录新增/更新、查询、删除、统计。
- `src/types.ts`：核心 TypeScript 类型定义。
- `src/router.ts`：通用 Router 类，目前主服务未直接使用。

### 客户端模块

- `weight_tracker/lib/services/weight_api_service.dart`：体重 API 客户端。
- `weight_tracker/lib/services/settings_service.dart`：本地用户设置存取。
- `weight_tracker/lib/models/weight_record.dart`：体重记录与统计模型。
- `weight_tracker/lib/models/user_settings.dart`：用户偏好设置模型。
- `weight_tracker/lib/config/api_config.dart`：后端地址配置。

## 4. API 设计

所有后端 API 都要求请求头：

```
X-User-Id: default_user
Content-Type: application/json
```

`X-User-Id` 只允许 `a-zA-Z0-9_-`，长度 1 到 64。

### 4.1 体重记录 API

#### 创建或更新体重记录

```
POST /weight-records
```

请求体：

```json
{
  "date": "2026-05-03",
  "morningWeight": 70.2,
  "eveningWeight": 71.0,
  "note": "运动后"
}
```

说明：

- 后端以 `X-User-Id` 为准，忽略 body 中的 `userId`。
- 同一用户同一天只能有一条记录。
- 已存在记录时执行更新，不存在时创建。

响应：

```json
{
  "id": "uuid",
  "userId": "default_user",
  "date": "2026-05-03",
  "morningWeight": 70.2,
  "eveningWeight": 71,
  "note": "运动后",
  "createdAt": "2026-05-03T00:00:00.000Z",
  "updatedAt": "2026-05-03T00:00:00.000Z"
}
```

#### 查询体重记录列表

```
GET /weight-records?startDate=2026-05-01&endDate=2026-05-03&page=1&pageSize=20
```

响应：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

#### 获取单条体重记录

```
GET /weight-records/:id
```

#### 删除体重记录

```
DELETE /weight-records/:id
```

响应：

```json
{
  "success": true
}
```

#### 查询体重统计

```
GET /weight-records/stats?startDate=2026-05-01&endDate=2026-05-03
```

响应：

```json
{
  "avgMorningWeight": 70.1,
  "avgEveningWeight": 70.8,
  "minWeight": 69.9,
  "maxWeight": 71.2,
  "change": 0.8
}
```

### 4.2 通知 API

#### 创建通知

```
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

#### 查询通知列表

```
GET /notifications?type=system&isRead=false&page=1&pageSize=20
```

#### 获取单条通知

```
GET /notifications/:id
```

#### 标记单条通知已读

```
POST /notifications/:id
```

#### 标记全部通知已读

```
POST /notifications/read-all
```

#### 删除通知

```
DELETE /notifications/:id
```

## 5. 数据模型

### 5.1 notifications

```sql
CREATE TABLE notifications (
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
```

索引：

```sql
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_type ON notifications(user_id, type);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, deleted);
```

### 5.2 weight_records

```sql
CREATE TABLE weight_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  morning_weight REAL,
  evening_weight REAL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, date)
);
```

索引：

```sql
CREATE INDEX idx_weight_records_user_date ON weight_records(user_id, date);
```

## 6. 核心校验规则

体重记录：

- `date` 必须是 `YYYY-MM-DD`。
- 日期不能晚于当前日期。
- `morningWeight` 和 `eveningWeight` 至少填写一项。
- 体重范围为 `20.0kg` 到 `300.0kg`。
- `note` 最多 200 字符。
- 同一用户同一天唯一。

通知：

- `type` 可选值：`system`、`order`、`message`、`campaign`。
- `priority` 可选值：`low`、`normal`、`high`。
- 标题最多 100 字符。
- 内容最多 2000 字符。
- 删除为软删除，设置 `deleted = 1`。

## 7. 安全与访问控制

- 用户身份通过 `X-User-Id` Header 传入。
- 服务端强制使用 Header 中的用户 ID，忽略请求体或查询参数中的用户 ID。
- 获取、删除、标记已读等操作均会校验资源归属。
- 请求体最大限制为 100KB。
- CORS 允许来源包括：
  - `http://localhost:3000`
  - `http://localhost:8080`

## 8. 运行与测试

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

后端默认监听：

```
http://localhost:3000
```

Flutter 客户端 API 地址配置在：

```
weight_tracker/lib/config/api_config.dart
```

## 9. 当前实现注意事项

- 后端统计字段为 `avgMorningWeight`、`avgEveningWeight`、`minWeight`、`maxWeight`、`change`。
- Flutter `WeightStats.fromJson` 当前读取的是 `avgMorning`、`avgEvening`、`min`、`max`、`change`，与后端字段存在不一致，建议统一。
- `src/router.ts` 提供了通用路由类，但当前 `src/server.ts` 使用手写路径分发。
- SQLite 数据库文件位于项目根目录的 `notifications.db`。