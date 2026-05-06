# 测试报告 — tester-case

## 测试信息

- **测试时间**: 2026-05-06
- **测试人**: tester-case
- **测试对象**: 体重记录 + 通知服务后端
- **测试方式**: 单元测试（weight-record、notification）+ HTTP 集成测试（server）+ 专项测试（auth、integration-edge）
- **运行命令**: `NODE_ENV=test npx jest --runInBand --forceExit`

---

## 测试执行结果

### 全部通过 ✅

```
Test Suites: 5 passed, 5 total
Tests:       257 passed, 257 total
```

| 测试套件 | 测试数 | 结果 |
|----------|--------|------|
| weight-record.test.ts | 69 | ✅ 通过 |
| notification.test.ts | 58 | ✅ 通过 |
| server.test.ts | 69 | ✅ 通过 |
| auth.test.ts | 31 | ✅ 通过 |
| integration-edge-cases.test.ts | 50 | ✅ 通过 |

---

## 测试套件说明

### 1. auth.test.ts（新增，31 个测试）

HMAC-SHA256 认证逻辑专项单元测试：

| ID | 测试内容 |
|----|----------|
| AUTH-UNIT-001 | 签名生成：确定性、不同 userId 不同、长度64字符、Unicode 支持 |
| AUTH-UNIT-002 | userId 格式验证：合法格式、长度边界、空格/特殊字符/HTML 拒绝 |
| AUTH-UNIT-003 | 认证检查逻辑：完整组合测试（missing/invalid/mismatch/error cases） |
| AUTH-UNIT-004 | 不同 AUTH_SECRET 产生不同签名 |

### 2. integration-edge-cases.test.ts（新增，50 个测试）

集成测试边缘场景：

| 分类 | 测试内容 |
|------|----------|
| **Rate Limiting** | 速率限制逻辑验证：首次请求通过、超限触发、IP 隔离 |
| **Body Size** | 100KB 上限（边界通过、超限返回 413） |
| **Health** | /health 返回字段验证、无需认证、numeric uptime |
| **CORS** | 非允许 origin 无 CORS headers、preflight 返回 204+Max-Age |
| **Error Format** | 认证/验证/404/500 均返回 JSON success:false 格式 |
| **Stats Accuracy** | 单条/仅 evening/混合早晚/日期范围/小数精度/微小变化 |
| **Notification Ordering** | 按 created_at DESC 排序、软删除不影响顺序 |
| **Note Handling** | undefined/null/空字符串/whitespace trimming/特殊字符 |
| **Upsert Flow** | 完整生命周期：创建→更新→删除 |
| **User Isolation** | User A/B 数据完全隔离（列表/统计/通知） |
| **Type Validation** | 服务器端类型校验（非字符串体重、非法 period/type） |
| **Query Params** | 空参数/负数 page/isRead 过滤 |
| **Route Conflict** | /notifications/:id 优先于 /notifications/read-all |
| **Read-All Isolation** | markAllAsRead 仅影响当前用户、count=0 边界 |

---

## 测试覆盖率总结

| 模块 | 覆盖内容 |
|------|----------|
| **体重记录 CRUD** | 创建(morning/evening)、查询(列表/单条)、更新(upsert)、删除、userId 强制 |
| **体重验证** | 范围 20-300kg、NaN/Infinity、日期格式、period 枚举、future date、XSS |
| **体重统计** | avgMorning/EveningWeight、min/max、change、avgWeightDiff、浮点精度 |
| **通知 CRUD** | 创建(全部字段)、列表(过滤/分页)、已读标记、read-all、软删除、hardDelete |
| **通知验证** | 标题长度(100)/内容长度(2000)、XSS、type/priority 枚举、批量(100上限) |
| **通知隔离** | 跨用户 CRUD 拒绝、markAllAsRead 隔离 |
| **HMAC 认证** | 签名生成/验证、timingSafeEqual、userId 格式校验、header 组合 |
| **CORS** | preflight/allowed origins/access-control headers |
| **速率限制** | 每 IP 独立限制、超限返回 429 |
| **Body Size** | 100KB 上限、超限返回 413 |
| **错误处理** | 无效 JSON、空 body、未知路由、服务器错误的 JSON 格式一致性 |
| **API 路由** | 路由优先级、特异路径 vs 通配路径 |

---

## 技术说明

- 集成测试使用 `NODE_ENV=test`（server.ts 在测试模式下使用动态端口 `server.listen(0)`）
- 使用 `jest.mock('../src/db')` 注入内存 SQLite，测试完全隔离
- 单元测试每用例创建独立 in-memory DB，afterEach 清理
- 运行命令: `NODE_ENV=test npx jest --runInBand --forceExit`
