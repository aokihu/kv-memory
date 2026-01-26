# `/update_memory` & `/update_memory_key` HTTP API

## 概述

该文档描述当前系统对记忆管理的 HTTP API，重点介绍新实现的 `/update_memory` 与 `/update_memory_key` 接口。说明涵盖基础配置、接口差异、请求/响应格式、错误处理以及使用示例，帮助开发者准确对接与替换现有记忆更新逻辑。

## 基础信息

| 项目 | 说明 |
| --- | --- |
| 主机 | `http://localhost`（运行在 Bun 的开发/生产环境） |
| 端口 | 默认 `3000`（可通过环境变量覆盖） |
| 协议 | `HTTP/1.1` |
| 内容类型 | `application/json`（所有请求与响应） |
| 身份验证 | 暂无（调用者需在运行环境中保证安全网络隔离） |

## 现有 API 接口列表

| 方法 | 路径 | 描述 |
| --- | --- | --- |
| `GET` | `/login` | 获取或刷新会话，返回当前 Agent 状态元信息。 |
| `POST` | `/add_memory` | 添加新记忆，包含键名、文本、元数据。 |
| `POST` | `/get_memory` | 查询现有记忆，支持按键名或 tag 过滤。 |
| `POST` | `/update_memory` | **新实现**：更新记忆内容与属性。 |
| `POST` | `/update_memory_key` | **新实现**：在不修改内容的情况下重命名记忆键。 |

## `/update_memory` 接口详细说明

**用途**：在 Key–Value 记忆层同步更新已有记忆的核心内容（`text`/`summary` 等）、授权信息或关联元数据。

### 请求

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 记忆键名，不能为空，必须已存在。 |
| `summary` | `string` | 记忆摘要，可选但建议提供以便索引优化。 |
| `text` | `string` | 记忆全文内容，必选。 |
| `meta` | `object` | 可更新的元数据（如 `source`, `tags`, `priority`），仅覆盖提供字段。 |
| `links` | `array` | 关联记忆列表（每项包含 `targetKey` 与 `relation`），接口会自动校验关联有效性。 |

### 响应

```json
{
  "status": "ok",
  "data": {
    "key": "decision-123",
    "summary": "用户故事调整",
    "text": "新方案分两个阶段...",
    "meta": {"priority": "high", "updatedBy": "agent-1"}
  }
}
```

成功返回更新后的记忆对象，未提供字段保持原值。

### 特性

- 允许部分更新（只需包含需要变更字段）。
- 内部会进行 Zod 校验保证 schema 兼容。
- 触发记忆状态评估（active/cold）以确保后续检索一致。

## `/update_memory_key` 接口详细说明

**用途**：在不改变记忆内容的前提下修改记忆的键名，保证所有外部引用（如 `links`、`constraints`）与新 key 同步。

### 请求

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `oldKey` | `string` | 当前存在的记忆键。 |
| `newKey` | `string` | 新键名，必须唯一且符合命名规范（不含空格、长度 <= 64）。 |

### 响应

```json
{
  "status": "ok",
  "data": {
    "oldKey": "bugfix-12",
    "newKey": "bugfix-12-critical"
  }
}
```

接口会完成以下操作：

1. 校验新键名与旧键名的存在性
2. 原地重命名，保持内容、meta、links 不变
3. 批量更新所有 `links` 中的 source/target 引用

## 错误代码和消息

| HTTP | 代码 | 描述 | 可能场景 |
| --- | --- | --- | --- |
| `400` | `bad_request` | 参数格式错误 | 缺少 `key`/`text` 或 `newKey` 不合法。 |
| `404` | `memory_not_found` | 目标记忆不存在 | 提供的 `key`/`oldKey` 不在存储中。 |
| `409` | `duplicate_key` | 新键名已存在 | `/update_memory_key` 的 `newKey` 与已有键冲突。 |
| `422` | `validation_error` | Zod 校验失败 | `meta` 内字段类型不匹配。 |
| `500` | `internal_error` | 服务执行失败 | 数据库连接异常或写入回滚。 |

### 错误示例

```json
{
  "status": "error",
  "code": "duplicate_key",
  "message": "newKey 'decision-2025' already exists"
}
```

## 使用示例

### 1. 更新记忆内容

```bash
curl -X POST http://localhost:3000/update_memory \
  -H "Content-Type: application/json" \
  -d '{
    "key": "decision-123",
    "summary": "用户故事调整",
    "text": "阶段A：完成原型，阶段B：用户研究",
    "meta": {"priority": "high"}
  }'
```

返回最新存储的记忆，供前端或 Agent 继续调用。

### 2. 重命名记忆键

```bash
curl -X POST http://localhost:3000/update_memory_key \
  -H "Content-Type: application/json" \
  -d '{"oldKey": "decision-123", "newKey": "decision-2025"}'
```

该调用适用于记忆重构等需要保持引用一致性的场景。

## 与现有 API 的对比

| 特性 | `/add_memory` | `/update_memory` | `/update_memory_key` |
| --- | --- | --- | --- |
| 是否可复用 | 否（新建） | 是（针对现有 key） | 是（保持内容，但改 key） |
| 支持部分更新 | ❌ | ✅（只需提供变更字段） | ❌（仅 key） |
| 会更新 `links` | ✅（初始链接） | ✅（允许修改 links） | ✅（重命名时同步引用） |
| 适用场景 | 创建新的 Agent 记忆 | 文本或 metadata 变更 | 组织结构变更、命名规范调整 |

| 特性 | `/get_memory` | `/update_memory` |
| --- | --- | --- |
| 方法 | `POST` | `POST` |
| 作用 | 查询记忆 | 修改记忆 |
| 安全 | 只读 | 写入（可能触发状态评估） |

### 说明

- `/update_memory` 是原 `/update_memory`（或 `add_memory`）逻辑的进化版本，增加了 schema 驱动的字段校验、更好的链接校验与状态控制机制。
- `/update_memory_key` 侧重键名管理、避免在多 Agent 链接中产生引用失效。两者联合使用，可确保记忆在内容与组织结构层面的完整性。
