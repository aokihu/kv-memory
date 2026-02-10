# 客户端迁移指南：适配移除 `domain` 和 `type` 字段的新 API

本文档用于帮助客户端从旧版 Memory API 迁移到新版 API。新版中，`domain` 和 `type` 已从 Memory 数据结构中移除。

## 1) 变更概述

### 发生了什么

- **破坏性变更**：请求和响应中的 `domain`、`type` 字段不再被支持。
- **影响范围**：`memory_add`、`memory_update` 的请求体构造逻辑，以及 `memory_get` 的响应解析逻辑。
- **服务端行为**：客户端若继续提交 `domain`/`type`，会触发参数校验错误（HTTP 场景通常为 400；MCP 工具返回 `success: false` 错误消息）。

### 迁移前后字段对比

- **迁移前（旧）**：
  - `value.summary`
  - `value.text`
  - `value.domain` (removed)
  - `value.type` (removed)
  - `value.links`
- **迁移后（新）**：
  - `value.summary`
  - `value.text`
  - `value.links`

### 推荐替代方式

- 原先放在 `domain`/`type` 的分类语义，建议迁移到：
  - `summary`（简要分类提示）
  - `text`（保留详细上下文）
  - `links.term`（需要显式关联语义时）

## 2) 客户端代码更新步骤

### Step 1: 更新本地类型定义

删除客户端模型中的 `domain`、`type`，避免继续向服务端发送旧字段。

```ts
export type MemoryValue = {
  summary: string;
  text: string;
  links?: Array<{ type: string; term: string; weight: number }>;
};
```

### Step 2: 更新请求构造器（`memory_add` / `memory_update`）

- 删除请求体中的 `value.domain` 和 `value.type`。
- 若你的客户端仍接收旧数据结构，先在发送前做一次 normalize。

```ts
type LegacyMemoryValue = MemoryValue & {
  domain?: string;
  type?: string;
};

export function normalizeMemoryValue(input: LegacyMemoryValue): MemoryValue {
  const { domain, type, ...rest } = input;
  const contextParts = [domain, type].filter(Boolean).join("/");

  return contextParts
    ? { ...rest, summary: `${rest.summary} [${contextParts}]` }
    : rest;
}
```

### Step 3: 更新响应解析器（`memory_get`）

- 删除对 `payload.data.domain`、`payload.data.type` 的读取逻辑。
- 所有分支判断改为基于 `payload.data.summary` / `payload.data.text`。

### Step 4: 更新错误处理

- 对参数校验失败（400）增加提示：客户端可能仍在发送已移除字段。
- 在日志中打印出最终发送 payload，确认没有 `domain`/`type`。

### Step 5: 回归测试

- `memory_add`：发送 payload 不包含 `domain`/`type`，请求成功。
- `memory_update`：局部更新不包含 `domain`/`type`，请求成功。
- `memory_get`：响应解析无 `domain`/`type` 依赖，UI/下游流程正常。

## 3) 常见问题解答（FAQ）

### Q1: 继续发送 `domain`/`type` 会怎样？

会被服务端校验拒绝并返回错误。请删除这两个字段后重试。

### Q2: 原本用 `domain`/`type` 做分类，迁移后怎么做？

建议将分类信息写入 `summary` 或 `text`，必要时通过 `links.term` 保留结构化提示。

### Q3: 是否需要一次性改完所有客户端？

建议优先改写所有写入路径（`memory_add`/`memory_update`），否则会持续触发服务端校验错误。

### Q4: 读取老数据会受影响吗？

读取逻辑应假设新结构不包含 `domain`/`type`。若你有历史兼容层，建议在客户端本地做降级处理，不要向新 API 回传旧字段。

### Q5: 为什么建议加 normalize 适配层？

可以先兼容旧输入模型，降低一次性改造风险，再逐步清理上游调用点。

## 4) 示例代码对比

### 4.1 `memory_add` 请求体

**Before (旧)：**

```json
{
  "tool": "memory_add",
  "arguments": {
    "key": "decision/sqlite",
    "value": {
      "summary": "选择 SQLite",
      "text": "用于本地高频读写",
      "domain": "architecture",
      "type": "decision",
      "links": []
    }
  }
}
```

**After (新)：**

```json
{
  "tool": "memory_add",
  "arguments": {
    "key": "decision/sqlite",
    "value": {
      "summary": "选择 SQLite",
      "text": "用于本地高频读写",
      "links": [
        { "type": "design", "term": "architecture/decision", "weight": 0.7 }
      ]
    }
  }
}
```

### 4.2 `memory_update` 请求体

**Before (旧)：**

```json
{
  "tool": "memory_update",
  "arguments": {
    "key": "decision/sqlite",
    "value": {
      "type": "design"
    }
  }
}
```

**After (新)：**

```json
{
  "tool": "memory_update",
  "arguments": {
    "key": "decision/sqlite",
    "value": {
      "summary": "SQLite 方案细化（design）"
    }
  }
}
```

### 4.3 客户端解析逻辑

**Before (旧)：**

```ts
if (payload.data.type === "decision") {
  renderDecisionCard(payload.data);
}
```

**After (新)：**

```ts
if (payload.data.summary.includes("decision")) {
  renderDecisionCard(payload.data);
}
```
