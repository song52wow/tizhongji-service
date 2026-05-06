# E2E 测试报告

**测试时间**: 2026-05-06 (更新)
**测试工程师**: tester-e2e
**测试框架**: Playwright 1.59.1
**被测服务**: tizhongji-service (Node.js HTTP Server)
**服务地址**: http://localhost:3000 (本地) / http://120.25.223.237:3000 (阿里云)

---

## 测试摘要

| 项目 | 结果 |
|------|------|
| 测试用例总数 | **86** |
| 通过 | **86** |
| 失败 | 0 |
| 跳过 | 0 |
| 通过率 | **100%** |

---

## 测试套件

| 套件 | 用例数 | 结果 |
|------|--------|------|
| HMAC 认证测试 (auth.test.ts) | 7 | ✅ 全部通过 |
| 体重记录 E2E 测试 (weight-record.test.ts) | 23 | ✅ 全部通过 |
| 通知中心 E2E 测试 (notification.test.ts) | 20 | ✅ 全部通过 |
| 完整用户流程测试 (user-flow.test.ts) | 7 | ✅ 全部通过 |
| 健康检查 E2E 测试 (health.test.ts) | 5 | ✅ 全部通过 |
| 输入验证边界测试 (input-validation.test.ts) | 24 | ✅ 全部通过 |

---

## 测试用例详情

### 1. HMAC 认证测试 (E2E-AUTH-001 ~ E2E-AUTH-007)

| 用例 | 场景 | 结果 |
|------|------|------|
| E2E-AUTH-001 | 有效 HMAC 签名 → 200 | ✅ |
| E2E-AUTH-002 | 缺少 X-User-Id → 401 | ✅ |
| E2E-AUTH-003 | 缺少 X-User-Signature → 401 | ✅ |
| E2E-AUTH-004 | 无效 X-User-Id 格式 (特殊字符) → 401 | ✅ |
| E2E-AUTH-005 | 无效签名 → 401 | ✅ |
| E2E-AUTH-006 | OPTIONS 预检请求 → 204 | ✅ |
| E2E-AUTH-007 | 不同用户签名不同 | ✅ |

### 2. 体重记录 E2E 测试 (E2E-WEIGHT-001 ~ E2E-WEIGHT-023)

| 用例 | 场景 | 结果 |
|------|------|------|
| E2E-WEIGHT-001 | 早体重记录创建 | ✅ |
| E2E-WEIGHT-002 | 晚体重记录创建 | ✅ |
| E2E-WEIGHT-003 | 同日早+晚体重 → weightDiff 计算正确 | ✅ |
| E2E-WEIGHT-004 | 更新已有记录 (同一时段) | ✅ |
| E2E-WEIGHT-005 | 体重低于下限 (15kg) → 400 | ✅ |
| E2E-WEIGHT-006 | 体重高于上限 (350kg) → 400 | ✅ |
| E2E-WEIGHT-007 | NaN 体重 → 400 | ✅ |
| E2E-WEIGHT-008 | 未来日期 → 400 | ✅ |
| E2E-WEIGHT-009 | 无效日期格式 (2026-13-01) → 400 | ✅ |
| E2E-WEIGHT-010 | 无效 period (afternoon) → 400 | ✅ |
| E2E-WEIGHT-011 | 备注含 HTML 标签 → 400 | ✅ |
| E2E-WEIGHT-012 | 备注含事件处理器 → 400 | ✅ |
| E2E-WEIGHT-013 | 分页功能正常 | ✅ |
| E2E-WEIGHT-014 | 按 period 过滤 | ✅ |
| E2E-WEIGHT-015 | 日期范围过滤 | ✅ |
| E2E-WEIGHT-016 | 按 ID 获取单条记录 | ✅ |
| E2E-WEIGHT-017 | 删除体重记录 | ✅ |
| E2E-WEIGHT-018 | 体重统计 (avgMorning/Evening, min, max, change, avgDiff) | ✅ |
| E2E-WEIGHT-019 | 跨用户隔离 - B 无法读取 A 的记录 → 404 | ✅ |
| E2E-WEIGHT-020 | 跨用户隔离 - B 无法删除 A 的记录 → 404 | ✅ |
| E2E-WEIGHT-021 | A 的列表不包含 B 的数据 | ✅ |
| E2E-WEIGHT-022 | 空数据返回空列表 | ✅ |
| E2E-WEIGHT-023 | 空数据统计返回 null | ✅ |

### 3. 通知中心 E2E 测试 (E2E-NOTIF-001 ~ E2E-NOTIF-020)

| 用例 | 场景 | 结果 |
|------|------|------|
| E2E-NOTIF-001 | 创建通知 | ✅ |
| E2E-NOTIF-002 | 创建带优先级的通知 | ✅ |
| E2E-NOTIF-003 | 支持所有 type (system/order/message/campaign) | ✅ |
| E2E-NOTIF-004 | 无效 type → 400 | ✅ |
| E2E-NOTIF-005 | 无效 priority → 400 | ✅ |
| E2E-NOTIF-006 | 标题超长 (>100字符) → 400 | ✅ |
| E2E-NOTIF-007 | 内容超长 (>2000字符) → 400 | ✅ |
| E2E-NOTIF-008 | 标题含 HTML → 400 | ✅ |
| E2E-NOTIF-009 | 列表按 createdAt DESC 排序 | ✅ |
| E2E-NOTIF-010 | 按 type 过滤 | ✅ |
| E2E-NOTIF-011 | 按 isRead 过滤 | ✅ |
| E2E-NOTIF-012 | 标记单条通知已读 | ✅ |
| E2E-NOTIF-013 | 批量标记全部已读 | ✅ |
| E2E-NOTIF-014 | 软删除通知 | ✅ |
| E2E-NOTIF-015 | 分页正常 | ✅ |
| E2E-NOTIF-016 | 跨用户 - B 无法读取 A 的通知 → 404 | ✅ |
| E2E-NOTIF-017 | 跨用户 - B 无法标记 A 的通知已读 → 404 | ✅ |
| E2E-NOTIF-018 | 跨用户 - B 无法删除 A 的通知 → 404 | ✅ |
| E2E-NOTIF-019 | 获取单条通知详情 | ✅ |
| E2E-NOTIF-020 | A 的列表不包含 B 的通知 | ✅ |

### 4. 完整用户流程测试 (E2E-FLOW-001 ~ E2E-FLOW-007)

| 用例 | 场景 | 结果 |
|------|------|------|
| E2E-FLOW-001 | 早→晚体重完整录入流程 | ✅ |
| E2E-FLOW-002 | 多日体重追踪流程 | ✅ |
| E2E-FLOW-003 | 体重录入+通知联动流程 | ✅ |
| E2E-FLOW-004 | 错误输入恢复流程 | ✅ |
| E2E-FLOW-005 | 速率限制验证 | ✅ |
| E2E-FLOW-006 | 100KB 请求体限制 | ✅ |
| E2E-FLOW-007 | 未知路由返回 404 | ✅ |

### 5. 健康检查 E2E 测试 (E2E-HEALTH-001 ~ E2E-HEALTH-005) — 新增

| 用例 | 场景 | 结果 |
|------|------|------|
| E2E-HEALTH-001 | /health 无需认证返回 200 | ✅ |
| E2E-HEALTH-002 | 允许的 Origin 返回 CORS 头 | ✅ |
| E2E-HEALTH-003 | 返回正确的 JSON Content-Type | ✅ |
| E2E-HEALTH-004 | 健康检查不受速率限制影响 | ✅ |
| E2E-HEALTH-005 | uptime 随时间递增 | ✅ |

### 6. 输入验证边界测试 (E2E-VALID-001 ~ E2E-VALID-022) — 新增

| 用例 | 场景 | 结果 |
|------|------|------|
| E2E-VALID-001 | 空请求体 → 400 | ✅ |
| E2E-VALID-002 | 缺少必填字段 → 400 | ✅ |
| E2E-VALID-003 | 体重=20kg (下限) → 200 | ✅ |
| E2E-VALID-004 | 体重=300kg (上限) → 200 | ✅ |
| E2E-VALID-005 | 体重=19.9kg (低于下限) → 400 | ✅ |
| E2E-VALID-006 | 体重=300.1kg (高于上限) → 400 | ✅ |
| E2E-VALID-007 | 纯空格备注被 trim 为空 | ✅ |
| E2E-VALID-008 | 备注=200字符 (最大长度) → 200 | ✅ |
| E2E-VALID-009 | 备注=201字符 → 400 | ✅ |
| E2E-VALID-010 | 纯空格通知标题 → 400 | ✅ |
| E2E-VALID-011 | 空通知标题 → 400 | ✅ |
| E2E-VALID-012 | 空通知内容 → 400 | ✅ |
| E2E-VALID-012b | 纯空格通知内容 → 400 | ✅ |
| E2E-VALID-012c | 混空格通知内容被 trim | ✅ |
| E2E-VALID-013 | 通知标题=100字符 → 200 | ✅ |
| E2E-VALID-014 | 无效 JSON → 400 | ✅ |
| E2E-VALID-015 | pageSize>100 自动上限 | ✅ |
| E2E-VALID-016 | page=-1 自动归 1 | ✅ |
| E2E-VALID-017 | isRead=无效布尔值 忽略过滤 | ✅ |
| E2E-VALID-018 | 体重小数精度接受 | ✅ |
| E2E-VALID-019 | Unicode 备注正确保存 | ✅ |
| E2E-VALID-020 | Unicode 通知标题/内容正确保存 | ✅ |
| E2E-VALID-021 | stats 日期范围过滤正确 | ✅ |
| E2E-VALID-022 | stats 无效日期 → 400 | ✅ |

---

## 发现并修复的问题

### 🔧 问题 1: 数据库 v2 Schema 迁移不完整

**严重级别**: HIGH
**描述**: `weight_records` 表同时存在旧约束 `UNIQUE(user_id, date)` 和新约束 `UNIQUE(user_id, date, period)`。这导致同一用户同一天无法同时创建早体重和晚体重记录，第二次创建返回 500 服务器错误。
**修复**: 重新创建 `weight_records` 表，仅保留 v2 约束 `UNIQUE(user_id, date, period)`，删除旧约束。
**影响**: 解决了 E2E-WEIGHT-003, E2E-WEIGHT-013, E2E-WEIGHT-018, E2E-FLOW-001/002/003 等用例失败问题。

### 🔧 问题 2: 通知标题/内容允许纯空格输入

**严重级别**: MEDIUM
**描述**: `createNotification()` 的校验逻辑在检查 `input.title.length > MAX_TITLE_LENGTH` 时，`'   '` (纯空格) 通过了长度检查（3 < 100），导致纯空格标题被保存为空字符串。通知标题/内容允许纯空白字符。
**发现方式**: E2E 输入边界测试发现
**修复**: 修改 `src/notification.ts` 校验逻辑，先对 `input.title.trim()` 和 `input.content.trim()` 检查是否为空，再检查长度：
```typescript
// 修复前
if (!input.title || typeof input.title !== 'string' || input.title.length > MAX_TITLE_LENGTH)
// 修复后
if (!input.title || typeof input.title !== 'string' || input.title.trim().length === 0)
if (input.title.length > MAX_TITLE_LENGTH)
```
**影响**: 修复了 E2E-VALID-010, E2E-VALID-012b。

---

## 测试环境配置

- **Node.js**: v20.20.0
- **Playwright**: 1.59.1
- **Chromium**: 已安装
- **AUTH_SECRET**: `dev-secret-change-in-production` (测试环境)
- **RATE_LIMIT_MAX**: 10000 (测试环境，生产环境默认 100)

### 测试文件结构

```
tests/e2e/
├── auth.ts                   # HMAC 签名生成工具
├── auth.test.ts             # 认证流程测试 (7用例)
├── weight-record.test.ts    # 体重记录测试 (23用例)
├── notification.test.ts     # 通知中心测试 (20用例)
├── user-flow.test.ts        # 完整用户流程测试 (7用例)
├── health.test.ts            # 健康检查测试 (5用例) ← 新增
├── input-validation.test.ts  # 输入边界测试 (24用例) ← 新增
└── E2E_TEST_REPORT.md       # 测试报告
```

### Playwright 配置

```javascript
// playwright.config.ts
{
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
  workers: 1,  // 避免触发速率限制
  reporter: ['list', 'html', 'json']
}
```

---

## 覆盖的 API 端点

| 端点 | 方法 | 状态 | 测试覆盖 |
|------|------|------|----------|
| `/health` | GET | ✅ | 完整 (5用例) |
| `/weight-records` | GET | ✅ | 完整 (列表/过滤/分页) |
| `/weight-records` | POST | ✅ | 完整 (创建/更新/验证) |
| `/weight-records/stats` | GET | ✅ | 完整 (统计计算/日期范围) |
| `/weight-records/{id}` | GET | ✅ | 完整 (获取/隔离) |
| `/weight-records/{id}` | DELETE | ✅ | 完整 (删除/隔离) |
| `/notifications` | GET | ✅ | 完整 (列表/过滤/分页) |
| `/notifications` | POST | ✅ | 完整 (创建/验证) |
| `/notifications/read-all` | POST | ✅ | 完整 (批量已读) |
| `/notifications/{id}` | GET | ✅ | 完整 (详情/隔离) |
| `/notifications/{id}` | POST | ✅ | 完整 (标记已读/隔离) |
| `/notifications/{id}` | DELETE | ✅ | 完整 (软删除/隔离) |

---

## 远程测试注意事项

**阿里云服务器 (120.25.223.237:3000)** 从当前网络不可达。E2E 测试在本地服务器 (localhost:3000) 执行。

**生产环境部署前建议**:
1. 配置正确的 `AUTH_SECRET` 环境变量
2. 将 `RATE_LIMIT_MAX` 调回 100
3. 更新 CORS 白名单包含正式前端域名
4. 确保数据库迁移脚本在生产环境执行

---

## 测试报告生成命令

```bash
cd tizhongji-service
npx playwright test --reporter=html,json
# 报告输出: playwright-report/index.html
```

---

*报告更新: 2026-05-06T14:05*
*测试工程师: tester-e2e*
*新增测试: health.test.ts (5用例), input-validation.test.ts (24用例)*
*代码修复: src/notification.ts (空格标题/内容校验)*
