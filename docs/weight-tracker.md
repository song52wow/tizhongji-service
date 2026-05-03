# 早晚体重记录与曲线图功能需求文档

## 1. 功能概述

### 1.1 功能名称
早晚体重记录与曲线图（Morning/Evening Weight Tracker）

### 1.2 功能简介
用户每天记录早晚两次体重数据，系统以曲线图形式展示体重变化趋势，帮助用户追踪健康目标达成情况。

### 1.3 目标用户
- 健身/减脂用户：监控体重变化趋势
- 健康管理用户：记录日常体重数据

---

## 2. 数据字段

### 2.1 体重记录实体：WeightRecord

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string (UUID) | 是 | 全局唯一标识 |
| `userId` | string | 是 | 用户ID |
| `date` | string | 是 | 记录日期，格式 YYYY-MM-DD |
| `morningWeight` | number | 否 | 早体重（kg），精确到0.1 |
| `eveningWeight` | number | 否 | 晚体重（kg），精确到0.1 |
| `note` | string | 否 | 备注（如"锻炼后"），最多200字符 |
| `createdAt` | timestamp | 是 | 创建时间 |
| `updatedAt` | timestamp | 是 | 更新时间 |

### 2.2 约束规则
- 同一用户同一天只能有一条记录（以 `date` + `userId` 唯一）
- 早体重和晚体重均需在 20.0 ~ 300.0 kg 范围内
- 早晚体重至少填写一项
- `date` 不能超过当前日期

---

## 3. UI 需求

### 3.1 体重记录页面

#### 3.1.1 记录表单
- 日期选择器：默认当天，支持选择历史日期
- 早体重输入框：数字输入，单位 kg，保留1位小数
- 晚体重输入框：数字输入，单位 kg，保留1位小数
- 备注输入框：可选，文本输入
- 保存按钮：提交记录

#### 3.1.2 体重曲线图
- **图表类型**：折线图（Line Chart）
- **X轴**：日期，按时间顺序排列
- **Y轴**：体重（kg），自动适配数据范围
- **两条数据线**：
  - 橙色线：早体重
  - 紫色线：晚体重
- **时间范围筛选**：支持切换「近7天」「近30天」「近90天」「全部」
- **交互**：
  - 点击数据点显示详情气泡（日期、早体重、晚体重、备注）
  - 长按数据点可编辑该条记录
- **空状态**：无数据时显示引导图和提示文案「记录第一天的体重吧」

### 3.2 数据统计区
- 显示筛选周期内的统计摘要：
  - 平均早体重、平均晚体重
  - 最低体重、最高体重
  - 体重变化量（起始 vs 最新）

---

## 4. API 接口设计

### 4.1 创建/更新体重记录
- `POST /weight-records`
- Body: `{ userId, date, morningWeight?, eveningWeight?, note? }`
- 若当日记录已存在，则更新（upsert）
- 返回: `{ id, userId, date, morningWeight, eveningWeight, note, createdAt, updatedAt }`

### 4.2 查询体重记录列表
- `GET /weight-records?userId=&startDate=&endDate=&page=&pageSize=`
- 按 `date` 升序排列
- 返回: `{ items, total, page, pageSize }`

### 4.3 获取单条体重记录
- `GET /weight-records/:id`
- 返回: 完整记录对象

### 4.4 删除体重记录
- `DELETE /weight-records/:id`
- 返回: `{ success: true }`

---

## 5. 技术方案

### 5.1 技术选型
- **运行环境**：Node.js >= 18
- **开发语言**：TypeScript
- **数据存储**：SQLite（文件数据库）
- **ORM**：better-sqlite3

### 5.2 项目结构

```
./src/
  weight-record.ts   # 体重记录核心模块
  db.ts              # 数据库初始化
  types.ts           # 类型定义
./docs/
  feature-doc.md     # 原用户通知中心文档
  weight-tracker.md  # 本文档
./tests/
  weight-record.test.ts
```

### 5.3 数据库设计

**表：weight_records**

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

CREATE INDEX idx_weight_records_user_date ON weight_records(user_id, date);
```

### 5.4 错误处理

| 场景 | HTTP状态码 | 错误信息 |
|------|------------|----------|
| 早体重超出范围 | 400 | "早体重需在 20.0~300.0 kg 范围内" |
| 晚体重超出范围 | 400 | "晚体重需在 20.0~300.0 kg 范围内" |
| 早晚体重均未填 | 400 | "早体重和晚体重至少填写一项" |
| 日期超过今天 | 400 | "日期不能超过当前日期" |
| 记录不存在 | 404 | "体重记录不存在" |
| 无权访问 | 403 | "无权访问此记录" |

---

## 6. 测试用例

| 用例编号 | 场景 | 预期结果 |
|----------|------|----------|
| WT-001 | 正常创建早体重记录 | 返回完整记录，包含 UUID |
| WT-002 | 填写早体重和晚体重 | 保存成功，两项均返回 |
| WT-003 | 早体重填写 15.0 kg | 返回 400 错误 |
| WT-004 | 早晚体重均不填 | 返回 400 错误 |
| WT-005 | 查询指定用户近7天记录 | 按日期升序返回记录列表 |
| WT-006 | 获取不存在的记录ID | 返回 404 错误 |
| WT-007 | 更新已存在的记录（同一日期） | 记录被覆盖，`updatedAt` 更新 |
| WT-008 | 删除体重记录后查询 | 记录不再出现 |