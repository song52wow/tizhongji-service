# 体重记录与通知中心 PRD

## 1. 产品概述

### 1.1 产品定位

体重记录与通知中心是一款帮助用户持续记录每日体重变化、观察趋势并接收系统通知的工具型应用。

核心功能：

- **早晚体重记录**：每天分别记录早晨和晚上体重（v2 拆分为独立记录）
- **体重曲线图**：可视化展示体重变化趋势
- **数据统计**：平均值、最低/最高体重、体重变化量
- **用户通知中心**：接收系统、订单、消息、活动等类型通知

### 1.2 目标用户

- 正在减脂、增肌或维持体重的人群
- 需要长期监测体重变化的用户
- 希望区分早晚体重差异、观察趋势的人群

### 1.3 产品范围

| 模块 | 说明 |
|---|---|
| 体重记录 | 早晚体重记录、曲线图、统计 |
| 通知中心 | 通知创建、查询、已读/删除 |
| 用户管理 | 多用户隔离（通过 X-User-Id Header） |

---

## 2. 功能需求

### 2.1 体重记录

#### 2.1.1 早晚体重记录（v2）

> **v2 变更**：早上和晚上的记录拆分为独立记录，同一天可存在早晨和晚上记录各一条，若二者同时存在则计算差值。

**数据模型**：`WeightRecord`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string (UUID) | 是 | 全局唯一标识 |
| `userId` | string | 是 | 用户ID |
| `date` | string | 是 | 记录日期，格式 YYYY-MM-DD |
| `period` | string | 是 | 时段：`morning` 或 `evening` |
| `weight` | number | 是 | 体重（kg），精确到 0.1 |
| `note` | string | 否 | 备注，最多 200 字符 |
| `createdAt` | timestamp | 是 | 创建时间 |
| `updatedAt` | timestamp | 是 | 更新时间 |

**业务规则**：

- 同一用户同一天同一时段只能有一条记录（`date + userId + period` 唯一）
- 同一用户同一天可存在早晨和晚上记录各一条
- 若某日同时存在早晚记录，`weightDiff = eveningWeight - morningWeight`
- 体重范围：`20.0 ~ 300.0 kg`
- 日期不能超过当前日期（使用本地时间）
- `NaN`、`Infinity`、`-Infinity` 不可通过校验
- 备注最多 200 字符，保存时去除首尾空格

**错误信息**：

| 场景 | HTTP 状态码 | 错误信息 |
|---|---|---|
| 体重超出范围 | 400 | `体重需在 20.0~300.0 kg 范围内` |
| 体重未填 | 400 | `体重为必填项` |
| 日期超过今天 | 400 | `日期不能超过当前日期` |
| 日期格式错误 | 400 | `日期格式不正确，应为 YYYY-MM-DD` |
| `period` 非法 | 400 | `period 必须是 morning 或 evening` |
| 备注过长 | 400 | `备注最多200字符` |
| 记录不存在或无权访问 | 404 | `体重记录不存在或无权访问` |

#### 2.1.2 体重曲线图

- **图表类型**：折线图（Line Chart）
- **X 轴**：日期，按时间顺序排列
- **Y 轴**：体重（kg），自动适配数据范围
- **两条数据线**：橙色线表示早体重，紫色线表示晚体重
- **时间范围筛选**：「近 7 天」「近 30 天」「近 90 天」「全部」
- **交互**：
  - 点击数据点显示详情气泡（日期、体重、备注）
  - 长按数据点可编辑该条记录
- **空状态**：无数据时显示「记录第一天的体重吧」

#### 2.1.3 数据统计

显示筛选周期内的统计摘要：

| 统计项 | 说明 |
|---|---|
| 平均早体重 | 所有早体重的算术平均值 |
| 平均晚体重 | 所有晚体重的算术平均值 |
| 最低体重 | 统计范围内最低体重 |
| 最高体重 | 统计范围内最高体重 |
| 体重变化量 | 最后有效体重 - 第一有效体重 |
| **v2 新增** 平均体重差值 | 同日早晚体重差值的平均值 |

- 所有统计结果保留 1 位小数
- 空数据时所有字段返回 `null`

### 2.2 首页概览

- 今日早晨体重、今日晚上体重
- 最近一次记录体重及相比上一条的变化值
- 最近 7 天体重趋势简图
- 快捷记录入口

### 2.3 历史记录

- 按时间倒序展示，支持按日期筛选
- 支持查看、编辑、删除每条记录

### 2.4 通知中心

#### 2.4.1 通知类型

| 类型 | 说明 |
|---|---|
| `system` | 系统通知 |
| `order` | 订单通知 |
| `message` | 消息通知 |
| `campaign` | 活动通知 |

#### 2.4.2 优先级

| 优先级 | 说明 |
|---|---|
| `low` | 低优先级 |
| `normal` | 普通（默认） |
| `high` | 高优先级 |

#### 2.4.3 业务规则

- 标题最多 100 字符
- 内容最多 2000 字符
- 标题和内容保存时去除首尾空格
- 删除为软删除（设置 `deleted = 1`）
- 支持批量标记全部已读

---

## 3. 页面结构

| 页面 | 主要模块 |
|---|---|
| 首页 | 当前体重卡片、今日记录入口、最近趋势图、最近记录列表 |
| 记录页 | 日期选择、早晚切换、体重输入、备注、保存 |
| 趋势页 | 体重曲线图、时间范围筛选、早晚/对比切换、数据点详情 |
| 历史页 | 历史记录列表、日期筛选、编辑/删除操作 |

---

## 4. API 设计

### 4.1 认证要求

所有 API 必须携带请求头：

```
X-User-Id: <userId>
Content-Type: application/json
```

- `X-User-Id` 格式：`a-zA-Z0-9_-`，长度 1 到 64
- 服务端强制使用 Header 中的 `userId`，忽略请求体或查询参数中的 `userId`
- 缺少认证：返回 `401`
- 格式非法：返回 `400`

### 4.2 体重记录 API（v2）

#### 创建或更新体重记录

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

响应：`200` 返回完整 `WeightRecord` 对象。

#### 查询体重记录列表（按日期聚合）

```
GET /weight-records?startDate=&endDate=&page=1&pageSize=20
```

响应：

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
- 按 `date ASC` 排序

#### 获取每日体重对比（v2 新增）

```
GET /weight-records/daily?startDate=&endDate=
```

专门用于获取按日期聚合的早晚体重对比数据，响应格式同上。

#### 获取体重统计数据（v2）

```
GET /weight-records/stats?startDate=&endDate=
```

响应：

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

- `avgWeightDiff` 仅统计同日期同时存在早晚记录的差值
- 统计不受分页影响

#### 获取单条体重记录

```
GET /weight-records/:id
```

响应：`200` 记录对象，或 `404` 记录不存在或无权访问。

#### 删除体重记录

```
DELETE /weight-records/:id
```

响应：`200 { success: true }`，或 `404` 记录不存在或无权访问。

### 4.3 通知 API

#### 创建通知

```
POST /notifications
```

请求体：`{ type, title, content, priority? }`

#### 查询通知列表

```
GET /notifications?type=&isRead=&page=1&pageSize=20
```

响应：`{ items, total, page, pageSize }`，按 `created_at DESC` 排序。

#### 获取单条通知

```
GET /notifications/:id
```

响应：`200` 通知对象，或 `404` 通知不存在或无权访问。

#### 标记通知已读

```
POST /notifications/:id
```

响应：`200 { success: true }`，或 `404` 通知不存在或无权访问。

#### 标记全部通知已读

```
POST /notifications/read-all
```

响应：`200 { success: true, count: N }`

#### 删除通知

```
DELETE /notifications/:id
```

响应：`200 { success: true }`，或 `404` 通知不存在或无权访问（软删除）。

---

## 5. 安全与访问控制

### 5.1 身份认证

当前使用轻量 Header 方案（`X-User-Id`）。生产环境应替换为 JWT、Session 或网关签发的可信身份。

### 5.2 对象级授权

所有对象级操作（读取、删除、标记已读）都必须验证资源所有权：

- 体重记录：查询/删除条件包含 `user_id = ?`
- 通知：查询/更新/删除条件包含 `user_id = ?`

用户只能访问自己的数据。

### 5.3 CORS

CORS 白名单：`http://localhost:3000`、`http://localhost:8080`。生产部署前需要配置正式前端域名。

### 5.4 请求体限制

最大 100KB，超限返回 `413`。

---

## 6. 数据库设计

### 6.1 weight_records（v2）

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

CREATE INDEX idx_weight_records_user_date ON weight_records(user_id, date);
```

### 6.2 notifications

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

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_type ON notifications(user_id, type);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, deleted);
```

---

## 7. 验收标准

### 7.1 体重记录

- 可成功新增、编辑、删除体重记录
- 同一天同一时段不会产生重复记录
- 同一天可同时存在早、晚记录各一条
- 曲线图正确展示早体重、晚体重及对比趋势
- 支持按 7 天、30 天、90 天和自定义范围查看趋势
- 若同日同时存在早晚记录，`weightDiff` 正确计算
- 统计接口包含 `avgWeightDiff`
- 历史记录与曲线图数据保持一致
- 体重范围限制为 `20.0~300.0 kg`
- `NaN`/`Infinity`/`-Infinity` 不可通过校验
- 日期格式严格校验（可拦截 `2024-02-30` 等无效日期）

### 7.2 通知中心

- 可创建、查询、标记已读、删除通知
- 软删除后通知不再出现
- 跨用户读取、标记已读和删除均失败
- `markAllAsRead` 仅影响当前用户

### 7.3 通用

- 所有 API 未认证返回 `401`
- 跨用户访问返回 `404`（不暴露资源存在性）
- CORS 仅对白名单来源放行

---

## 8. v2 数据库迁移

由于 `weight_records` 表结构发生根本性变化（`morning_weight` + `evening_weight` 共存 → `period` + `weight` 独立），建议：

1. 新增 `period` 列并迁移数据（将原有记录按 `morningWeight`/`eveningWeight` 拆分为两条）
2. 或保留旧表，新建 `weight_records_v2` 表，过渡期双写
3. 迁移完成后删除旧列

---

## 9. 生产前注意事项

| 问题 | 级别 | 说明 |
|---|---|---|
| X-User-Id 无服务端签名验证 | CRITICAL | 客户端可伪造任意身份，建议替换为 JWT/Session |
| 无速率限制 | HIGH | 易遭暴力枚举 |
| CORS 仅限 localhost | HIGH | 生产环境无法访问 |
| Flutter 静默吞掉 API 错误 | HIGH | 用户无法感知错误 |

---

## 10. 变更历史

| 版本 | 日期 | 变更内容 |
|---|---|---|
| v1 | 2026-05-02 | 初始版本：早晚体重共存于同一条记录 |
| v2 | 2026-05-03 | 需求变更：拆分为独立记录，新增 `weightDiff` 和 `avgWeightDiff` |
