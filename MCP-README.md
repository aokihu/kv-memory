# MCP 服务端使用说明

## 目录
- [项目概述](#项目概述)
- [安装与设置](#安装与设置)
- [快速开始](#快速开始)
- [可用工具](#可用工具)
  - [`session_new`](#session_new)
  - [`memory_add`](#memory_add)
  - [`memory_get`](#memory_get)
  - [`memory_update`](#memory_update)
  - [`memory_rename`](#memory_rename)
  - [`memory_search`](#memory_search)
  - [`memory_fulltext_search`](#memory_fulltext_search)
  - [`bulk_read_memory`](#bulk_read_memory)
- [可用资源](#可用资源)
- [可用提示](#可用提示)
- [传输方式](#传输方式)
- [环境变量](#环境变量)
- [示例用法](#示例用法)
- [故障排除](#故障排除)

## 项目概述

`kvdb-mem` 的 `MCP` 服务端基于 `fastmcp`，对外暴露了一组用于管理短期/长期记忆的工具、资源和提示。服务端聚焦在：

- 维护**Session** 与**记忆游走**状态 (`last_memory_key`)。
- 暴露工具来创建会话、写入/读取记忆，能够被 MCP 客户端或 LLM 轻松调用。
- 兼容 `stdio` 与 HTTP Streaming/SSE 传输协议，便于嵌入 Agent orchestration 环境。

此文档以开发者视角说明如何启动服务、调用工具、访问 `memory://` 资源以及使用内置提示。

## 安装与设置

1. 安装依赖：

   ```bash
   bun install
   ```

2. `MCP` 服务器入口在 `package.json` 中的 `mcp` 脚本，实际执行 `bun run ./src/mcp.ts`。
3. 运行前无需手动创建数据库，`SessionService` 与 `KVMemoryService` 会在首次写入时创建 `session.db` / `kv.db`。

## 快速开始

1. **启动服务**（默认 STDIO 模式）：

   ```bash
   bun run mcp
   ```

2. **准备客户端**：使用任何兼容 MCP 的客户端（例如 `@modelcontextprotocol/sdk`、FastMCP CLI、或自定义 STDIO 管道）向服务器发送工具调用。
3. **调用工具例程**：

   ```jsonc
   // 新建会话
   {
     "tool": "session_new",
     "arguments": {}
   }
   
   // 添加记忆
    {
      "tool": "memory_add",
      "arguments": {
        "key": "decision/42",
        "value": {
          "summary": "将记忆存入 KVDB",
          "text": "...更长的背景描述...",
          "links": []
        }
      }
   }

   // 读取记忆
   {
     "tool": "memory_get",
     "arguments": {
       "key": "decision/42",
       "session": "<session-key-from-previous-response>"
     }
   }
   ```

   服务响应会附带 `success` 及 `session` 信息，`memory_get` 还会同步更新会话的 `last_memory_key`，用于 `traverseMemory`。

## 可用工具

### `session_new`

- **用途**：显式生成会话 ID，并将其写入 STDIO 会话缓存。
- **参数**：空对象 `{}`。
- **返回值**：

  ```json
  {
    "success": true,
    "session": "<session-key>"
  }
  ```
- **说明**：如果你在一次 STDIO 会话中不持续发送 `session`，可以定期调用该工具以更换/刷新 Key。

### `memory_add`

- **用途**：把 `MemoryNoMeta` 结构写入 SQLite Key–Value 层。
- **参数结构**：

  ```json
  {
    "key": "唯一字符串",
    "value": {
      "summary": "1-2 句话的概述",
      "text": "更详细内容",
      "links": []
    }
  }
  ```

- **注意**：`links` 可省略，服务端会填充空数组再写入。
- **可选参数**：通过 `output_format` 调整工具返回数据格式，支持 `toon`（默认）与 `json`，便于客户端解析。
- **返回值**：`{ success: true, key: "..." }` 或包含 `message` 的错误对象。

### `memory_get`

- **用途**：根据 `key` 读取**单条**记忆，同时维护 `Session` 中 `last_memory_key`，触发历史遍历（`traverseMemory`）以便做上下文扩散。
- **说明**：此为**单条读取工具**，只返回指定 `key` 的单个记忆。如需批量读取多条关联记忆，请使用 [`bulk_read_memory`](#bulk_read_memory) 工具。
- **参数**：

  ```json
  {
    "key": "decision/42",
    "session": "<可选的 session key>",
    "sortLinks": true,  // 可选，控制links数组是否排序，默认 true
    "output_format": "toon"  // 可选，默认 toon，可设置为 json
  }
  ```

- **参数说明**：
  - `key`：记忆的唯一标识符，必填
  - `session`：可选的会话ID，用于上下文追踪
  - `sortLinks`：控制返回的links数组是否按综合得分排序，可选，支持boolean类型或字符串"true"/"false"，默认 `true`
  - `output_format`：输出格式，可选 `toon` 或 `json`，默认 `toon`

- **行为**：
  1. 如果传入 `session` 或 STDIO 缓存里有，会尝试加载已有会话并跑一次 `traverseMemory(last_memory_key)`，保持路径一致。
  2. 每次调用都更新 `Session` 为当前 `key`。
- **返回**：默认返回 TOON 格式，包含 `success`、`session`、`session_refreshed` 及完整的 `Memory` 数据；可通过 `output_format: "json"` 获取 JSON 输出（错误响应始终返回 JSON）。

### `memory_update`

- **用途**：局部更新指定记忆的内容，支持只变更 `summary`/`text` 等字段。
- **参数**：

  ```json
  {
    "key": "project_design",
    "value": {
      "summary": "Updated project design summary",
      "text": "Updated detailed design description"
    },
    "session": "session_123"
  }
  ```
- **可选参数**：支持 `output_format`（`toon` | `json`），默认 TOON，以便于 Agent 在不同客户端解析。

- **行为**：
  1. 验证 `session` 有效性，失败时返回 `success: false` 及提示。
  2. 确认目标 `key` 对应记忆存在。
  3. 使用 `MemoryNoMetaSchema.partial()` 做局部更新，并写回 KV 层。
  4. 返回 `{ "success": true, "key": "project_design" }`。
- **返回**：`{ "success": true, "key": "project_design" }`，失败时包含 `message`。

### `memory_rename`

- **用途**：在不丢失记忆内容的前提下更换 `key`，便于整理与归档。
- **参数**：

  ```json
  {
    "old_key": "old_design",
    "new_key": "new_design",
    "session": "session_123"
  }
  ```
- **可选参数**：可以传入 `output_format`（`toon` 或 `json`），默认 `toon`。

- **行为**：
  1. 校验 `session`（若提供），确保会话尚可用。
  2. 验证 `old_key` 与 `new_key` 不相同。
  3. 确保 `old_key` 已存在并可读。
  4. 确保 `new_key` 目前不存在，避免覆盖。
  5. 在 KV 层完成重命名并返回成功状态。

  - **返回**：`{ "success": true, "old_key": "old_design", "new_key": "new_design" }`

### `memory_search`

- **用途**：执行基础关键词搜索，返回包含指定关键词的记忆。支持通过 session 进行 namespace 过滤。
- **参数**：

  ```json
  {
    "query": "量子计算",
    "session": "session_key_here",
    "sortLinks": true,  // 可选，控制links数组是否排序，默认 true
    "limit": 20,
    "offset": 0,
    "highlight": true,
    "output_format": "json"
  }
  ```

- **参数说明**：
  - `query`：搜索关键词，必填
  - `session`：可选的会话ID，用于namespace过滤。提供有效session时，只返回该session对应namespace下的记忆
  - `sortLinks`：控制返回的links数组是否按综合得分排序，可选，支持boolean类型或字符串"true"/"false"，默认 `true`
  - `limit`：返回结果数量限制，可选，默认 20，最大 100
  - `offset`：结果偏移量，用于分页，可选，默认 0
  - `highlight`：是否在结果中高亮关键词，可选，默认 true
  - `output_format`：输出格式，可选 `toon` 或 `json`，默认 `toon`

- **行为**：
  1. 验证搜索功能是否启用（通过 `KVDB_SEARCH_ENABLED` 环境变量控制）
  2. 如果提供了 `session`，验证 session 有效性并提取对应的 namespace
  3. 执行 SQLite FTS5 搜索，按相关性排序
  4. 如果指定了 namespace，只返回 key 以 `{namespace}:` 开头的记忆
  5. 返回搜索结果和分页信息

- **Session 验证错误**：
  - 无效的 session 返回 `{"success": false, "message": "invalid session"}`

- **返回示例**（JSON 格式）：
  ```json
  {
    "success": true,
    "data": {
      "results": [
        {
          "key": "Zeus:global:tech:quantum",
          "summary": "量子计算技术文档",
          "excerpt": "...采用<mark>量子</mark>计算方案...",
          "relevance": 0.85,
          "score": 0.85
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

### `memory_fulltext_search`

- **用途**：执行全文搜索，支持多关键词组合和逻辑运算符。支持通过 session 进行 namespace 过滤。
- **参数**：

  ```json
  {
    "keywords": "量子,计算,比特",
    "session": "session_key_here",
    "sortLinks": true,  // 可选，控制links数组是否排序，默认 true
    "operator": "OR",
    "limit": 20,
    "offset": 0,
    "highlight": true,
    "output_format": "json"
  }
  ```

- **参数说明**：
  - `keywords`：逗号分隔的关键词列表，必填
  - `session`：可选的会话ID，用于namespace过滤。提供有效session时，只返回该session对应namespace下的记忆
  - `sortLinks`：控制返回的links数组是否按综合得分排序，可选，支持boolean类型或字符串"true"/"false"，默认 `true`
  - `operator`：逻辑运算符，可选 `AND`（所有关键词必须匹配）或 `OR`（任一关键词匹配），默认 `OR`
  - `limit`：返回结果数量限制，可选，默认 20，最大 100
  - `offset`：结果偏移量，用于分页，可选，默认 0
  - `highlight`：是否在结果中高亮关键词，可选，默认 true
  - `output_format`：输出格式，可选 `toon` 或 `json`，默认 `toon`

- **行为**：
  1. 验证搜索功能是否启用
  2. 如果提供了 `session`，验证 session 有效性并提取对应的 namespace
  3. 根据运算符组合关键词执行搜索
  4. 如果指定了 namespace，只返回 key 以 `{namespace}:` 开头的记忆
  5. 返回搜索结果和分页信息

- **Session 验证错误**：
  - 无效的 session 返回 `{"success": false, "message": "invalid session"}`

- **返回示例**（JSON 格式）：
  ```json
  {
    "success": true,
    "data": {
      "results": [
        {
          "key": "Zeus:global:tech:quantum-bits",
          "summary": "量子比特技术说明",
          "excerpt": "<mark>量子</mark><mark>比特</mark>是<mark>量子</mark>计算的基本单位...",
          "relevance": 0.92,
          "score": 0.92
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

- **搜索功能配置**：
  搜索功能可以通过以下环境变量配置：
  - `KVDB_SEARCH_ENABLED`：是否启用搜索功能，默认 `true`
  - `KVDB_SEARCH_DEFAULT_LIMIT`：默认搜索结果数量，默认 `20`
  - `KVDB_SEARCH_MAX_LIMIT`：最大搜索结果数量，默认 `100`

### `bulk_read_memory`

- **用途**：批量读取指定记忆及其关联记忆，支持通过深度优先遍历获取完整上下文网络。适用于需要获取某个主题相关完整记忆链路的场景。
- **说明**：此为**批量读取工具**，与 `memory_get`（单条读取）不同，它会自动遍历关联链路并返回多条相关记忆。
- **参数**：

  ```json
  {
    "key": "project:architecture",
    "session": "session_key_here",
    "depth": 3,
    "breadth": 5,
    "total": 20,
    "sortLinks": true,
    "output_format": "json"
  }
  ```

- **参数说明**：
  - `key`：目标记忆的key，**必填**。作为遍历的起始节点。
  - `session`：可选的会话ID，用于namespace过滤和上下文追踪。提供有效session时，只返回该session对应namespace下的记忆。
  - `depth`：遍历深度限制，可选，默认`3`，范围`1-6`。控制遍历的层级深度，防止无限递归。
  - `breadth`：每层最大关联记忆数，可选，默认`5`，范围`1-20`。控制每层最多探索的关联记忆数量。
  - `total`：总计返回记忆数上限，可选，默认`20`，范围`1-50`。包括目标记忆和所有关联记忆的总数限制。
  - `sortLinks`：控制返回的links数组是否按综合得分排序，可选，支持boolean类型或字符串`"true"`/`"false"`，默认`true`。
  - `output_format`：输出格式，可选`toon`或`json`，默认`toon`。JSON格式便于程序解析，TOON格式便于人工阅读。

- **行为**：
  1. 验证`key`参数，目标记忆必须存在。
  2. 如果提供了`session`，验证session有效性并提取对应的namespace，用于过滤返回结果。
  3. 从目标记忆开始，按照深度优先策略遍历关联链路（通过`links`字段）。
  4. 应用`depth`、`breadth`、`total`参数限制遍历范围，防止返回过多数据。
  5. 收集所有访问到的记忆节点，包含目标记忆和关联记忆。
  6. 根据`sortLinks`参数决定是否对每条记忆的`links`数组进行排序。
  7. 按照`output_format`参数返回格式化结果。

- **返回结构**：

  ```json
  {
    "success": true,
    "data": {
      "targetMemory": {
        "key": "project:architecture",
        "value": {
          "summary": "系统架构设计",
          "text": "详细的架构设计文档...",
          "links": [
            {"targetKey": "project:database", "strength": 0.9}
          ]
        },
        "meta": {
          "createdAt": "2024-01-15T10:30:00Z",
          "lastAccessAt": "2024-01-15T14:20:00Z",
          "accessCount": 5,
          "score": 85
        }
      },
      "associatedMemories": [
        {
          "key": "project:database",
          "value": {
            "summary": "数据库设计方案",
            "text": "数据库选型与结构设计...",
            "links": [...]
          },
          "meta": {...},
          "retrievalInfo": {
            "depth": 1,
            "weight": 0.9,
            "path": ["project:architecture", "project:database"]
          }
        }
      ],
      "metadata": {
        "depthReached": 3,
        "totalRetrieved": 15,
        "duplicatesSkipped": 2,
        "traversalTimeMs": 45
      }
    }
  }
  ```

- **使用示例**：

  **基础批量读取**（使用默认参数）：

  ```json
  {
    "tool": "bulk_read_memory",
    "arguments": {
      "key": "project:architecture",
      "output_format": "json"
    }
  }
  ```

  **自定义遍历参数**（深度探索）：

  ```json
  {
    "tool": "bulk_read_memory",
    "arguments": {
      "key": "project:architecture",
      "depth": 5,
      "breadth": 10,
      "total": 40,
      "sortLinks": true,
      "output_format": "json"
    }
  }
  ```

  **带Session的批量读取**（Namespace过滤）：

  ```json
  {
    "tool": "bulk_read_memory",
    "arguments": {
      "key": "project:architecture",
      "session": "your_session_key_here",
      "depth": 3,
      "output_format": "json"
    }
  }
  ```

- **故障排除**：

  - **`bulk_read_memory`返回"记忆不存在"**：
    - 确认`key`拼写正确，区分大小写
    - 使用`memory_get`验证记忆是否存在
    - 检查是否需要添加namespace前缀（如`session_key:memory_key`）

  - **返回的关联记忆数量少于预期**：
    - 检查目标记忆的`links`数组是否为空
    - 查看返回的`metadata.duplicatesSkipped`，可能有关联记忆因重复被跳过
    - 调整`depth`、`breadth`、`total`参数扩大搜索范围
    - 如果使用了`session`过滤，确认该namespace下确实存在关联记忆

  - **遍历过慢或返回数据过大**：
    - 减小`depth`参数（建议从3开始逐步增加）
    - 减小`breadth`参数限制每层探索数量
    - 减小`total`参数限制总返回数量
    - 避免对具有大量关联的"枢纽"记忆进行深度遍历

  - **参数验证错误**：
    - 确认`depth`在1-6范围内
    - 确认`breadth`在1-20范围内
    - 确认`total`在1-50范围内
    - 确认`key`参数不为空且为有效字符串

## 可用资源

### `memory://{key}`

- **用途**：只读资源模板，用于快速把某条记忆以 JSON 文本暴露给客户端或提示。
- **访问方式**：任何支持 `resource` URI 的 MCP 客户端都可以传递参数 `key`，FastMCP 会调用 `KVMemoryService.getMemory` 并返回：

  ```json
  {
    "uri": "memory://decision/42",
    "text": "{ ... memory ... }"
  }
  ```

- **备注**：异常自动被捕获并返回 `success: false` 及 `message`，使提示不必再补充错误处理逻辑。

## 可用提示

### `capture_memory`

- **用途**：提供一个固定 Prompt 模板，引导 LLM 产出合法的 `MemoryNoMeta` JSON。
- **合同**：提示要求输出字段 `key`、`value.summary`、`value.text`、`value.links`。
- **建议**：在 `value.links` 不清楚时返回空数组，后续由工具补全；生成 JSON 后再调用 `memory_add`。

### `recall_memory`

- **用途**：让 Agent 记得去调用 `memory_get` 工具获取记忆，同时自动追踪 `session`。
- **提示内容**：提醒 Agent 如果没有会话先调用 `session_new`，否则直接用 `memory_get`。

## 传输方式

服务默认在 STDIO 模式运行（`transportType: "stdio"`），适合直接在命令行/脚本中使用。

### HTTP Streaming

- 通过设置 `MCP_TRANSPORT=httpstream`/`http`/`sse` 可以启动 HTTP 流式服务。
- 默认监听 `http://localhost:8787/mcp`，同时还会开放 `/sse` 以兼容 SSE 客户端。
- 客户端可以使用 `StreamableHTTPClientTransport`（HTTP） 或 `SSEClientTransport`（SSE）连接，交互格式与 STDIO 一致。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MCP_TRANSPORT` | `stdio` | 传输类型，可选值 `stdio` / `httpstream` / `http` / `sse` |
| `MCP_PORT` | `8787` | HTTP stream 服务监听端口，仅对 HTTP 相关传输有效 |
| `MCP_HOST` | (未设置) | 绑定的主机地址，留空为自动匹配 |
| `MCP_ENDPOINT` | `/mcp` | HTTP 流式服务的路径，向下兼容 `fastmcp` 默认 |
| `MCP_OUTPUT_FORMAT` | `toon` | 默认 `memory_*` 工具的输出格式，可选 `toon` 或 `json`；错误响应始终为 JSON。 |
| `KVDB_SEARCH_ENABLED` | `true` | 是否启用搜索功能，设置为 `false` 可禁用搜索 |
| `KVDB_SEARCH_DEFAULT_LIMIT` | `20` | 默认搜索结果数量限制 |
| `KVDB_SEARCH_MAX_LIMIT` | `100` | 最大搜索结果数量限制 |

其他 `Bun` 环境变量（如 `BUN_DEBUG`）可继续用于 Bun 运行时行为。

## 示例用法

### STDIO 模式

```bash
bun run mcp
```

然后在另一个终端或脚本里写入 JSON：

```bash
cat <<'EOF' >/tmp/mcp.cmd
{ "tool": "session_new", "arguments": {} }
{ "tool": "memory_add", "arguments": { "key": "note/intro", "value": { "summary": "记录 MCP 说明", "text": "...", "links": [] } } }
{ "tool": "memory_get", "arguments": { "key": "note/intro" } }
{ "tool": "memory_update", "arguments": { "key": "note/intro", "value": { "summary": "调整后的简介", "text": "补充了更多背景" } } }
{ "tool": "memory_rename", "arguments": { "old_key": "note/intro", "new_key": "note/mcp_intro" } }
{ "tool": "memory_get", "arguments": { "key": "note/mcp_intro" } }
EOF

# 通过管道/脚本发送给 STDIO 服务
cat /tmp/mcp.cmd | bun run mcp
```

每一行 JSON 会被 `fastmcp` 识别为一条工具调用，响应逐行输出（可结合 `jq` 观察）。

### TOON格式输出示例

默认情况下，`memory_get` 返回 TOON 格式：

```
summary: 将记忆存入KVDB
text: ...更长的背景描述...
links[0]:
```

如需 JSON 格式，请指定 `output_format` 参数：

```json
{
  "tool": "memory_get",
  "arguments": {
    "key": "decision/42",
    "sortLinks": true,
    "output_format": "json"
  }
}
```

### 搜索工具使用示例

#### 基础关键词搜索

```json
{
  "tool": "memory_search",
  "arguments": {
    "query": "量子计算",
    "sortLinks": true,
    "limit": 10,
    "offset": 0,
    "highlight": true,
    "output_format": "json"
  }
}
```

#### 全文搜索（OR 运算符）

```json
{
  "tool": "memory_fulltext_search",
  "arguments": {
    "keywords": "量子,计算,比特",
    "sortLinks": true,
    "operator": "OR",
    "limit": 5,
    "output_format": "json"
  }
}
```

#### 全文搜索（AND 运算符）

```json
{
  "tool": "memory_fulltext_search",
  "arguments": {
    "keywords": "量子,计算",
    "operator": "AND",
    "limit": 10,
    "offset": 10,
    "output_format": "json"
  }
}
```

#### 带 Session 的搜索（Namespace 过滤）

```json
// 先创建 session
{
  "tool": "session_new",
  "arguments": {}
}

// 使用 session 进行搜索（只返回该 session namespace 下的记忆）
{
  "tool": "memory_search",
  "arguments": {
    "query": "量子计算",
    "session": "your_session_key_here",
    "limit": 10,
    "output_format": "json"
  }
}

// 带 session 的全文搜索
{
  "tool": "memory_fulltext_search",
  "arguments": {
    "keywords": "量子,计算",
    "session": "your_session_key_here",
    "operator": "OR",
    "limit": 10,
    "output_format": "json"
  }
}
```

**说明**：
- 提供有效的 `session` 后，搜索将只返回该 session 对应 namespace 下的记忆（key 以 `{namespace}:` 开头）
- 无效的 session 会返回错误：`{"success": false, "message": "invalid session"}`
- 不提供 session 时执行全局搜索（向后兼容）

### HTTP Streaming 模式

```bash
MCP_TRANSPORT=http MCP_PORT=9000 MCP_ENDPOINT=/mcp bun run mcp
```

Node 客户端示例（使用 Model Context Protocol SDK）：

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "dev", version: "0.1" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:9000/mcp"));

await client.connect(transport);
const session = await client.callTool({ name: "session_new", arguments: {} });
console.log(session);
await client.disconnect();
```

所有工具/资源/提示都可以通过同一个 `Client` 实例调用；`recall_memory` 提示会提示 Agent 先生成或复用 session。

## 故障排除

- **`bun run mcp` 失败**：确认 `bun` 版本 >= 1.0、`bun install` 已运行，且 `node_modules` 正常。
- **`memory_add` 报 `ZodError`**：确保 `value` 包含 `summary`、`text` 等必填字段；`links` 必须是数组。
- **HTTP 连接报 `ECONNREFUSED`**：检查 `MCP_TRANSPORT`、`MCP_PORT` 与 `MCP_ENDPOINT` 是否与客户端一致；若绑定到 `127.0.0.1`，外部无法访问。
- **Session 失效**：STDIO 模式下保持进程不重启，`session_new` 结果会缓存到全局 `stdioSession`；HTTP 模式建议每次调用后保存响应中的 `session` 字段。
- **资源 `memory://{key}` 返回 `success: false`**：确认记忆已写入并拼写一致；服务端会将错误文本放在 `message` 字段。
- **`memory_update` 失败**：常见原因包括提供了无效 `session`、指定 `key` 不存在或传入空的 `value`；检查返回的 `message` 获取详细提示。
- **`memory_rename` 失败**：`old_key` 必须存在且不同于 `new_key`，`new_key` 不可已存在；命令会在冲突时返回 `success: false` 并说明哪个检查没有通过。
- **`memory_search` 或 `memory_fulltext_search` 失败**：
  - 检查 `KVDB_SEARCH_ENABLED` 环境变量是否设置为 `true`
  - 确认数据库已正确初始化 FTS5 表（运行数据库迁移脚本）
  - 验证搜索参数格式正确（`query` 或 `keywords` 不能为空）
  - 检查 `operator` 参数只能是 `AND` 或 `OR`
  - 确认 `limit` 和 `offset` 是有效数字
  - **Session 相关错误**：
    - 如果返回 `invalid session`，检查 session 是否已过期（默认 3 分钟）
    - 重新调用 `session_new` 获取新 session
    - 确认 session 字符串拼写正确


## 批量读取记忆工具

系统支持批量读取关联记忆，通过深度优先遍历获取完整上下文。

### `memory_bulk_read`

- **用途**：批量读取指定记忆及其关联记忆，支持深度优先遍历
- **参数**：

  ```json
  {
    "key": "project:architecture",
    "session": "session_key_here",
    "depth": 3,
    "breadth": 5,
    "totalLimit": 20,
    "sortLinks": true,
    "output_format": "json"
  }
  ```

- **参数说明**：
  - `key`：目标记忆的key，必填
  - `session`：可选的会话ID，用于namespace过滤
  - `depth`：遍历深度限制，可选，默认3，范围1-6
  - `breadth`：每层最大关联记忆数，可选，默认5，范围1-20
  - `totalLimit`：总计返回记忆数上限，可选，默认20，范围1-50
  - `sortLinks`：控制返回的links数组是否排序，可选，默认true
  - `output_format`：输出格式，可选`toon`或`json`，默认`toon`

- **返回示例**（JSON格式）：

  ```json
  {
    "success": true,
    "data": {
      "targetMemory": {
        "key": "project:architecture",
        "value": {
          "summary": "系统架构设计",
          "text": "详细的架构设计文档...",
          "links": [...]
        },
        "meta": { "score": 85 }
      },
      "associatedMemories": [
        {
          "key": "project:database",
          "value": { },
          "meta": { },
          "retrievalInfo": {
            "depth": 1,
            "weight": 0.85
          }
        }
      ],
      "metadata": {
        "depthReached": 3,
        "totalRetrieved": 15,
        "duplicatesSkipped": 2
      }
    }
  }
  ```

### 使用示例

#### 基础批量读取

```json
{
  "tool": "memory_bulk_read",
  "arguments": {
    "key": "project:architecture",
    "output_format": "json"
  }
}
```

#### 自定义深度和广度

```json
{
  "tool": "memory_bulk_read",
  "arguments": {
    "key": "project:architecture",
    "depth": 4,
    "breadth": 8,
    "totalLimit": 30,
    "output_format": "json"
  }
}
```

### 批量读取故障排除

- **`memory_bulk_read` 返回记忆不存在**：
  - 确认key拼写正确
  - 使用 `memory_get` 验证记忆是否存在
  - 检查是否需要添加namespace前缀

- **返回的关联记忆数量少于预期**：
  - 检查目标记忆的links数组是否为空
  - 查看metadata中的duplicatesSkipped，可能有关联记忆因重复被跳过
  - 调整depth、breadth、totalLimit参数

- **参数验证错误**：
  - 确认depth在1-6范围内
  - 确认breadth在1-20范围内
  - 确认totalLimit在1-50范围内
