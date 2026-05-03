# 修复方案：calculateWeightStats 返回字段名不一致

## 1. 问题描述

`tester-agent` 测试发现 `weight-record.ts` 中 `calculateWeightStats` 函数的返回字段名与文档描述不一致：

| 当前代码字段 | 文档描述字段 |
|--------------|--------------|
| `avgMorning` | `avgMorningWeight` |
| `avgEvening` | `avgEveningWeight` |
| `min` | `minWeight` |
| `max` | `maxWeight` |
| `change` | `change` (一致) |

## 2. 影响范围

- 前端曲线图组件依赖明确的字段名进行数据渲染
- 字段名不一致将导致前端无法正确读取统计数据

## 3. 修复方案

### 方案A：修改代码以匹配文档（推荐）
将 `calculateWeightStats` 函数的返回对象字段名统一修改为完整命名：

```typescript
// 修改前
return {
  avgMorning,
  avgEvening,
  min,
  max,
  change,
};

// 修改后
return {
  avgMorningWeight,
  avgEveningWeight,
  minWeight,
  maxWeight,
  change,
};
```

同时更新对应的 TypeScript 类型定义：

```typescript
interface WeightStats {
  avgMorningWeight: number | null;
  avgEveningWeight: number | null;
  minWeight: number | null;
  maxWeight: number | null;
  change: number | null;
}
```

### 方案B：修改文档以匹配代码
将文档第 3.2 节中统计摘要的描述统一为代码中的字段名。

### 4. 推荐方案

**采用方案A**。理由：
1. 完整字段名（`avgMorningWeight`）与数据模型字段命名一致（`morningWeight`），保持系统一致性
2. 文档是实现的依据，代码应向文档看齐
3. 前端图表组件无需修改，直接受益

## 5. 实施步骤

1. 修改 `weight-record.ts` 中 `calculateWeightStats` 的返回字段名
2. 更新对应的 TypeScript 接口/类型定义
3. 更新单元测试中的断言字段名
4. 测试重新验证全部用例通过

## 6. 验证标准

- `calculateWeightStats` 返回对象的每个字段名与文档一致
- 单元测试全部通过
- TypeScript 编译无错误