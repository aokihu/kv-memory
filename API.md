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

---

# 搜索功能 API

## 概述

系统提供全文搜索功能，基于 SQLite FTS5 扩展实现。搜索功能支持关键词匹配、相关性排序、分页和结果高亮。

## 搜索 API 接口列表

| 方法 | 路径 | 描述 |
| --- | --- | --- |
| `GET` | `/search` | 基础关键词搜索，支持单个关键词搜索 |
| `GET` | `/fulltext` | 全文搜索，支持多关键词组合和逻辑运算符 |

## `/search` 接口详细说明

**用途**：执行基础关键词搜索，返回包含指定关键词的记忆。

### 请求参数

| 参数 | 类型 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `q` | `string` | 搜索关键词，必填 | - |
| `session` | `string` | 可选的会话ID，用于namespace过滤 | - |
| `limit` | `number` | 返回结果数量限制 | `20` |
| `offset` | `number` | 结果偏移量，用于分页 | `0` |
| `highlight` | `boolean` | 是否在结果中高亮关键词 | `true` |

**session 参数说明：**
- 当提供有效的 `session` 时，系统会验证 session 并提取其对应的 namespace
- 搜索将只返回该 namespace 下的记忆（key 以 `{namespace}:` 开头）
- 无效的 session 将返回 401 错误
- 不提供 session 时执行全局搜索（向后兼容）

### 响应格式

```json
{
  "status": "ok",
  "data": {
    "results": [
      {
        "key": "decision-123",
        "summary": "量子计算项目决策",
        "text": "我们决定采用量子计算方案...",
        "excerpt": "...采用<mark>量子</mark>计算方案...",
        "relevance": 0.85,
        "meta": {
          "createdAt": "2025-01-15T10:30:00Z",
          "updatedAt": "2025-01-16T14:20:00Z"
        }
      }
    ],
    "pagination": {
      "total": 42,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

### 特性

- 支持中英文关键词搜索
- 结果按相关性排序（FTS5 相关性算法）
- 支持分页，返回总结果数便于前端分页
- 可选的搜索结果高亮显示

## `/fulltext` 接口详细说明

**用途**：执行全文搜索，支持多关键词组合和逻辑运算符。

### 请求参数

| 参数 | 类型 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `keywords` | `string` | 逗号分隔的关键词列表，必填 | - |
| `session` | `string` | 可选的会话ID，用于namespace过滤 | - |
| `operator` | `string` | 逻辑运算符：`AND` 或 `OR` | `OR` |
| `limit` | `number` | 返回结果数量限制 | `20` |
| `offset` | `number` | 结果偏移量，用于分页 | `0` |
| `highlight` | `boolean` | 是否在结果中高亮关键词 | `true` |

**session 参数说明：**
- 与 `/search` 接口相同，提供 session 可限制搜索范围到特定 namespace
- 无效的 session 返回 401 错误
- 不提供 session 时执行全局搜索

### 响应格式

```json
{
  "status": "ok",
  "data": {
    "results": [
      {
        "key": "tech-quantum",
        "summary": "量子计算技术文档",
        "text": "量子比特是量子计算的基本单位...",
        "excerpt": "<mark>量子</mark>比特是<mark>量子</mark>计算的基本单位...",
        "relevance": 0.92,
        "meta": {
          "createdAt": "2025-01-10T09:15:00Z",
          "updatedAt": "2025-01-12T11:45:00Z"
        }
      }
    ],
    "pagination": {
      "total": 15,
      "limit": 20,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

### 特性

- 支持多个关键词同时搜索
- 支持 `AND`（所有关键词必须匹配）和 `OR`（任一关键词匹配）逻辑运算符
- 结果按相关性排序
- 支持分页和高亮显示

## 搜索错误代码和消息

| HTTP | 代码 | 描述 | 可能场景 |
| --- | --- | --- | --- |
| `400` | `bad_request` | 参数格式错误 | 缺少 `q` 或 `keywords` 参数 |
| `400` | `invalid_operator` | 无效的逻辑运算符 | `operator` 参数不是 `AND` 或 `OR` |
| `400` | `invalid_limit_offset` | 无效的分页参数 | `limit` 或 `offset` 不是有效数字 |
| `401` | `invalid_session` | 无效的会话 | 提供的 `session` 不存在或已过期 |
| `500` | `search_disabled` | 搜索功能未启用 | 系统配置中搜索功能被禁用 |

### 错误示例

```json
{
  "status": "error",
  "code": "bad_request",
  "message": "Missing required parameter: q"
}
```

## 搜索使用示例

### 1. 基础关键词搜索

```bash
curl -X GET "http://localhost:3000/search?q=量子&limit=10&offset=0"
```

### 2. 带 Session 的搜索（Namespace 过滤）

```bash
# 使用 session 进行 namespace 过滤搜索
curl -X GET "http://localhost:3000/search?q=量子&session=abc123&limit=10"

# 带 session 的全文搜索
curl -X GET "http://localhost:3000/fulltext?keywords=量子,计算&session=abc123&operator=OR"
```

**说明**：
- 有效的 session 会限制搜索范围到该 session 对应的 namespace
- key 以 `{namespace}:` 开头的记忆才会被返回
- 无效的 session 会返回 401 错误

### 3. 全文搜索（OR 运算符）

```bash
curl -X GET "http://localhost:3000/fulltext?keywords=量子,计算,比特&operator=OR&limit=5"
```

### 4. 全文搜索（AND 运算符）

```bash
curl -X GET "http://localhost:3000/fulltext?keywords=量子,计算&operator=AND&limit=10&offset=10"
```

### 5. 禁用高亮的搜索

```bash
curl -X GET "http://localhost:3000/search?q=博士&highlight=false"
```

## 搜索功能配置

搜索功能可以通过环境变量配置：

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `KVDB_SEARCH_ENABLED` | 是否启用搜索功能 | `true` |
| `KVDB_SEARCH_DEFAULT_LIMIT` | 默认搜索结果数量 | `20` |
| `KVDB_SEARCH_MAX_LIMIT` | 最大搜索结果数量 | `100` |

## 性能说明

- 搜索功能基于 SQLite FTS5 扩展，性能优化
- 支持索引优化命令：`POST /admin/optimize-fts-index`
- 支持索引重建命令：`POST /admin/rebuild-fts-index`
- 搜索结果缓存策略可配置
