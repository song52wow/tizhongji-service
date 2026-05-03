# 体重记录项目 CRITICAL 问题修复方案

## 背景与目标

根据 `docs/weight-tracker.md` 的 API 设计，体重记录数据以 `userId` 隔离，同一用户同一天只能有一条记录，且“获取单条记录”“删除记录”需要返回 `403 无权访问此记录`。本次测试反馈指出当前实现存在认证缺失、对象级权限缺失、CORS 过宽、统计口径错误等 CRITICAL 风险。

修复目标：

- 所有 API 请求都必须先通过认证，服务端只信任认证上下文中的用户身份。
- 所有读取、更新、删除操作都必须按 `userId` 做对象级授权。
- CORS 只允许明确可信来源，不再使用通配符 `*`。
- 统计接口必须统计筛选范围内全部记录，不受列表默认分页 20 条影响。
- 单元测试与接口测试覆盖越权访问、未认证访问、CORS、统计完整性等回归场景。

## 问题 1：整个 API 缺少用户认证/授权机制

### 具体修复步骤

1. 在 `src/server.ts` 增加统一认证中间层或请求前置校验。
2. 现阶段可使用项目已有的轻量 Header 方案作为最小可落地修复：从 `X-User-Id` 读取用户身份，并校验格式。后续生产环境应替换为 JWT、Session 或网关签发的可信身份。
3. 所有业务路由进入前必须存在已认证用户。缺失身份返回 `401`。
4. 服务端必须忽略客户端 Body 或 Query 中传入的 `userId`，统一使用认证上下文中的 `userId`。
5. 将 `Access-Control-Allow-Headers` 加入认证所需 Header；若改用 JWT，则加入 `Authorization`。
6. 为前端 `weight_tracker/lib/services/weight_api_service.dart` 增加统一请求 Header 注入，保证列表、创建、统计、删除等请求都携带认证身份。

### 代码变更建议

`src/server.ts`：

```ts
function getAuthenticatedUserId(req: IncomingMessage): string | null {
  const raw = req.headers['x-user-id'];
  if (typeof raw !== 'string') return null;

  const userId = raw.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) return null;

  return userId;
}
```

在路由分发前执行：

```ts
const userId = getAuthenticatedUserId(req);
if (!userId) {
  sendError(res, 401, '未认证或用户身份无效');
  return;
}
```

创建、查询、统计接口改为强制使用认证身份：

```ts
const input = await parseBody<CreateWeightRecordInput>(req);
const result = upsertWeightRecord({ ...input, userId });

const safeQuery: WeightRecordQuery = { ...query as WeightRecordQuery, userId };
```

前端服务层建议增加统一 Header：

```dart
Map<String, String> _headers(String userId) => {
  'Content-Type': 'application/json',
  'X-User-Id': userId,
};
```

### 修复后的预期行为

- 未携带认证身份访问任意业务接口，返回 `401`。
- 客户端伪造 Body 或 Query 中的 `userId` 不生效，服务端只使用认证 Header 中的用户身份。
- 用户只能看到、创建、更新、统计自己的体重记录和通知数据。

### 测试验证要点

- 不带 `X-User-Id` 调用 `GET /weight-records`、`POST /weight-records`、`GET /notifications`，均返回 `401`。
- 带非法 `X-User-Id`，例如空字符串、超长字符串、特殊字符，返回 `400` 或 `401`。
- Header 为 `user-a`，Body 或 Query 传 `user-b` 时，写入和查询结果仍归属 `user-a`。
- 前端所有 API 请求都能携带认证 Header。

## 问题 2：通知模块 markAsRead/deleteNotification/getNotificationById 无 userId 验证

### 具体修复步骤

1. 修改 `src/notification.ts` 的对象级函数签名，强制传入 `userId`。
2. SQL 查询和更新条件中加入 `user_id = ?`，避免先查全局 ID 再由路由判断。
3. `markAsRead` 只更新当前用户自己的通知。
4. `deleteNotification` 只删除当前用户自己的通知，软删除和硬删除都必须带 `user_id` 条件。
5. `getNotificationById` 只返回当前用户自己的通知。
6. 更新 `src/server.ts` 调用点，传入认证上下文 `userId`。
7. 更新 `tests/notification.test.ts`，增加跨用户越权测试。

### 代码变更建议

`src/notification.ts`：

```ts
export function getNotificationById(notificationId: string, userId: string): Notification | ErrorResponse {
  const row = db.prepare(
    'SELECT * FROM notifications WHERE id = ? AND user_id = ? AND deleted = 0'
  ).get(notificationId, userId.trim());
}

export function markAsRead(notificationId: string, userId: string): boolean | ErrorResponse {
  const result = db.prepare(
    'UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ? AND user_id = ? AND deleted = 0'
  ).run(readAt, notificationId, userId.trim());

  if (result.changes === 0) {
    return { success: false, error: '通知不存在或无权访问', statusCode: 404 };
  }
  return true;
}

export function deleteNotification(notificationId: string, userId: string, hardDelete = false): boolean | ErrorResponse {
  const sql = hardDelete
    ? 'DELETE FROM notifications WHERE id = ? AND user_id = ? AND deleted = 0'
    : 'UPDATE notifications SET deleted = 1 WHERE id = ? AND user_id = ? AND deleted = 0';
  const result = db.prepare(sql).run(notificationId, userId.trim());
  if (result.changes === 0) {
    return { success: false, error: '通知不存在或无权访问', statusCode: 404 };
  }
  return true;
}
```

`src/server.ts`：

```ts
const notification = getNotificationById(path[1], userId);
const result = markAsRead(path[1], userId);
const result = deleteNotification(path[1], userId);
```

### 修复后的预期行为

- 用户 A 无法通过通知 ID 读取、标记已读或删除用户 B 的通知。
- 越权操作不会改变用户 B 的通知状态。
- 对调用方可统一返回 `404 通知不存在`，减少通过 ID 枚举判断资源是否存在的风险；若产品明确需要区分，也可返回 `403 无权访问此通知`。

### 测试验证要点

- 用户 A 创建通知后，用户 B 调用 `getNotificationById(id, 'user-b')` 返回错误。
- 用户 B 调用 `markAsRead(id, 'user-b')` 后，用户 A 的通知仍为未读。
- 用户 B 调用 `deleteNotification(id, 'user-b')` 后，用户 A 仍可查询到该通知。
- `markAllAsRead(userId)` 仍只影响指定用户自己的未读通知。

## 问题 3：体重记录 getWeightRecordById/deleteWeightRecord 无权限检查

### 具体修复步骤

1. 修改 `src/weight-record.ts` 中 `getWeightRecordById` 和 `deleteWeightRecord` 的函数签名，强制传入 `userId`。
2. 所有 SQL 查询和删除都加上 `user_id = ?` 条件。
3. `src/server.ts` 不再先全局查询记录再比较 `record.userId`，而是直接调用带 `userId` 的底层函数。
4. 删除接口使用单条 SQL 带 owner 条件执行，根据 `changes` 判断是否成功。
5. 更新 `tests/weight-record.test.ts`，覆盖跨用户读取和删除。

### 代码变更建议

`src/weight-record.ts`：

```ts
export function getWeightRecordById(id: string, userId: string): WeightRecord | ErrorResponse {
  const row = db.prepare(
    'SELECT * FROM weight_records WHERE id = ? AND user_id = ?'
  ).get(id, userId.trim());

  if (!row) {
    return { success: false, error: '体重记录不存在或无权访问', statusCode: 404 };
  }
  return toWeightRecord(row);
}

export function deleteWeightRecord(id: string, userId: string): boolean | ErrorResponse {
  const result = db.prepare(
    'DELETE FROM weight_records WHERE id = ? AND user_id = ?'
  ).run(id, userId.trim());

  if (result.changes === 0) {
    return { success: false, error: '体重记录不存在或无权访问', statusCode: 404 };
  }
  return true;
}
```

`src/server.ts`：

```ts
const record = getWeightRecordById(path[1], userId);
const result = deleteWeightRecord(path[1], userId);
```

### 修复后的预期行为

- 用户 A 无法读取用户 B 的体重记录详情。
- 用户 A 无法删除用户 B 的体重记录。
- 即使未来有代码绕过 HTTP 层直接调用服务函数，也必须提供 `userId`，权限检查不会只依赖路由层。

### 测试验证要点

- 用户 A 创建记录后，用户 B 调用 `GET /weight-records/:id` 返回 `404` 或 `403`。
- 用户 B 调用 `DELETE /weight-records/:id` 不会删除用户 A 的记录。
- 用户 A 仍可正常读取和删除自己的记录。
- 直接调用 `getWeightRecordById(id, wrongUserId)` 和 `deleteWeightRecord(id, wrongUserId)` 均失败。

## 问题 4：CORS 配置使用通配符 * 存在安全风险

### 具体修复步骤

1. 移除 `Access-Control-Allow-Origin: *`。
2. 在 `src/server.ts` 定义允许来源白名单，开发环境可包含 `http://localhost:3000`、`http://localhost:8080`；生产环境从环境变量读取。
3. 仅当请求 `Origin` 命中白名单时返回对应的 `Access-Control-Allow-Origin`。
4. 预检请求 `OPTIONS` 同样执行 Origin 检查；不允许的 Origin 不返回 CORS 放行 Header。
5. 若未来使用 Cookie 或 Session，必须设置具体 Origin，并显式处理 `Access-Control-Allow-Credentials`，禁止与 `*` 组合。

### 代码变更建议

```ts
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8080')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);

const origin = req.headers.origin;
if (origin && ALLOWED_ORIGINS.has(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
```

### 修复后的预期行为

- 来自可信前端域名的浏览器请求可正常通过 CORS。
- 未在白名单中的站点无法通过浏览器跨域读取 API 响应。
- 响应中不再出现 `Access-Control-Allow-Origin: *`。

### 测试验证要点

- `Origin: http://localhost:3000` 时响应包含 `Access-Control-Allow-Origin: http://localhost:3000`。
- `Origin: http://evil.example` 时响应不包含 `Access-Control-Allow-Origin`。
- `OPTIONS` 预检请求对允许来源返回 `204` 和正确 CORS Header。
- 自动化测试断言任何响应都不包含 `Access-Control-Allow-Origin: *`。

## 问题 5：calculateWeightStats 默认只统计前 20 条记录导致数据错误

### 具体修复步骤

1. 不再复用带分页默认值的 `listWeightRecords(query)` 作为统计数据源。
2. 新增专用查询函数，按 `userId`、`startDate`、`endDate` 获取筛选范围内全部记录，不设置 `LIMIT/OFFSET`。
3. `calculateWeightStats` 使用全部记录计算平均值、最低体重、最高体重、变化量。
4. 保留列表接口分页行为，避免影响 `GET /weight-records`。
5. 统计接口继续由服务端强制注入认证用户 `userId`。

### 代码变更建议

`src/weight-record.ts`：

```ts
function listAllWeightRecordsForStats(query: WeightRecordQuery): WeightRecord[] | ErrorResponse {
  if (!query.userId || typeof query.userId !== 'string' || query.userId.trim() === '') {
    return { success: false, error: 'userId 为必填项', statusCode: 400 };
  }

  const conditions = ['user_id = ?'];
  const params: (string | number)[] = [query.userId.trim()];

  if (query.startDate) {
    conditions.push('date >= ?');
    params.push(query.startDate);
  }
  if (query.endDate) {
    conditions.push('date <= ?');
    params.push(query.endDate);
  }

  const rows = db.prepare(
    `SELECT * FROM weight_records WHERE ${conditions.join(' AND ')} ORDER BY date ASC`
  ).all(...params);

  return rows.map(toWeightRecord);
}

export function calculateWeightStats(query: WeightRecordQuery): WeightStats | ErrorResponse {
  const records = listAllWeightRecordsForStats(query);
  if ('success' in records && records.success === false) return records;

  const items = records as WeightRecord[];
  // 使用 items 计算 avgMorningWeight、avgEveningWeight、minWeight、maxWeight、change
}
```

`src/server.ts` 不应再通过 `pageSize: 10000` 规避问题，因为该方案在记录超过 10000 条时仍会出错，且会把统计正确性绑定到分页参数上。

### 修复后的预期行为

- 统计结果覆盖当前用户筛选周期内所有记录。
- 记录超过 20 条、100 条、10000 条时，统计结果仍正确。
- `GET /weight-records` 的分页结果不影响 `GET /weight-records/stats` 的统计口径。

### 测试验证要点

- 创建 25 条以上记录，断言平均值、最高值、最低值、变化量包含第 21 条之后的数据。
- 创建超过列表接口最大 `pageSize` 的记录，断言统计仍准确。
- 使用 `startDate` 和 `endDate` 时，只统计范围内记录。
- 用户 A 和用户 B 均有记录时，统计结果只包含当前认证用户的数据。

## 建议修复顺序

1. 先实现统一认证上下文，禁止匿名访问所有业务接口。
2. 修改通知和体重记录底层函数签名，所有对象级操作都必须带 `userId`。
3. 更新 `server.ts` 调用点，移除全局查询后再比较 owner 的模式。
4. 收紧 CORS 白名单，并补充预检请求测试。
5. 重写 `calculateWeightStats` 数据源，避免复用分页列表。
6. 更新单元测试、接口测试和前端 API Header。
7. 运行 `npm test`，必要时补充 Flutter 服务层测试或手动联调。

## 回归测试清单

- 认证：所有业务接口未认证返回 `401`。
- 授权：跨用户读取、修改、删除体重记录和通知全部失败。
- 数据隔离：列表、详情、统计、通知中心只返回当前用户数据。
- CORS：可信 Origin 被允许，不可信 Origin 不被允许，响应无 `*`。
- 统计：超过默认分页数量后统计结果仍正确。
- 兼容性：原有 `docs/weight-tracker.md` 中 WT-001 到 WT-008 仍全部通过。

---

## 问题 6（MEDIUM）：长按数据点编辑功能未实现

### 位置
`weight_tracker/lib/pages/home_page.dart`

### 需求
需求文档 §3.1.2 要求"长按数据点可编辑该条记录"，当前仅支持点击查看详情气泡。

### 修复方案
在曲线图 widget 上新增长按手势监听（`GestureDetector` + `onLongPress`），根据点击坐标换算对应日期的记录，找到对应记录后打开编辑弹窗（与点击详情气泡的交互逻辑共用同一编辑页面）。编辑完成后刷新曲线图数据。

验收标准：长按进入编辑状态，点击仍展示详情气泡，编辑后同步刷新曲线图。

---

## 问题 7（MEDIUM）：日期格式验证不严格

### 位置
`src/weight-record.ts:64`

### 需求
当前使用正则 `^\d{4}-\d{2}-\d{2}$` 仅校验格式，无法拦截如 `2024-02-30`（2 月 30 日）等无效日期。

### 修复方案
在正则校验通过后，使用 `new Date(input.date)` 将字符串解析为 JS Date 对象，然后验证 `date.getFullYear()、getMonth()+1、getDate()` 与输入的年月日一致。具体做法：
1. 先用正则确保格式正确（`YYYY-MM-DD`）
2. 拆分为年、月、日后用 `new Date(year, month - 1, day)` 重建 Date 对象
3. 比对重建后的年月日与输入一致，若不一致则说明日期非法（如 2 月 30 日）

验收标准：`2024-02-30`、`2024-13-01`、`2024-00-15` 等无效日期不可通过；`2024-02-29` 在闰年通过、非闰年不通过。

---

## 问题 8（MEDIUM）：体重未检查 NaN/Infinity

### 位置
`src/weight-record.ts:29-38`

### 需求
前端 Dart 的 `double.tryParse("abc")` 会返回 null，但后端若收到 `"morningWeight": NaN` 或 `Infinity`，直接通过范围校验（如 `weight >= 20 && weight <= 300`）。

### 修复方案
在体重范围验证时增加 `Number.isNaN()` 和 `Number.isFinite()` 检查：
```ts
function isValidWeight(w: any): boolean {
  return typeof w === 'number' && Number.isFinite(w) && !Number.isNaN(w) && w >= 20 && w <= 300;
}
```
同时在服务层对输入 JSON 中的体重值做此检查，拒绝非有限数值的请求。

验收标准：`NaN`、`Infinity`、`-Infinity` 均不可通过，返回 400 校验错误。

---

## 问题 9（LOW）：空状态引导文案与需求不符

### 位置
前端空状态展示处（home_page.dart 或对应 widget）

### 需求
需求文档 §3.1.2 要求空状态引导文案为"记录第一天的体重吧"，当前实现为"添加第一条体重记录吧"。

### 修复方案
将空状态引导文案从"添加第一条体重记录吧"改为"记录第一天的体重吧"。

验收标准：空数据时文案与需求文档一致。

---

## 问题 10（LOW）：GET /weight-records/stats 端点未在需求文档中列出

### 位置
需求文档 `./docs/feature-doc.md` §4 API 接口设计

### 需求
`GET /weight-records/stats` 端点已在后端实现并被 Flutter 前端使用，但未在需求文档 §4 中列出。

### 修复方案
在需求文档 §4.6（或新增 §4.6）补充 `GET /weight-records/stats` 端点的完整说明，包含：
- 请求参数：`startDate`（可选）、`endDate`（可选）
- 响应字段：`avgMorningWeight`（number | null）、`avgEveningWeight`（number | null）、`minWeight`（number | null）、`maxWeight`（number | null）、`change`（number | null）
- 空数据响应示例

验收标准：文档中的 API 列表与实际实现一致。

