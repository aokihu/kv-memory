# MCP 服务端使用说明

## 目录
- [项目概述](#项目概述)
- [安装与设置](#安装与设置)
- [快速开始](#快速开始)
- [可用工具](#可用工具)
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

- **用途**：根据 `key` 读取记忆，同时维护 `Session` 中 `last_memory_key`，触发历史遍历（`traverseMemory`）以便做上下文扩散。
- **参数**：

  ```json
  {
    "key": "decision/42",
    "session": "<可选的 session key>",
    "output_format": "toon"  // 可选，默认 toon，可设置为 json
  }
  ```

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
    "output_format": "json"
  }
}
```

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
