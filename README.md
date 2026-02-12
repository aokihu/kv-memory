# kvdb-mem

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## 存储实现

- 记忆存储使用 `bun:sqlite`（原生 SQLite）
- 记忆主表：`memories`
- 链接关系表：`memory_links`
- 当前项目以全新 SQLite 数据库启动，不包含 Keyv 迁移工具。

## MCP 服务端

项目还包含一个基于 `fastmcp` 构建的 MCP 服务端，实现了 session 管理、记忆的写入/读取、`memory://{key}` 资源和常用提示。更多使用方式与示例见 [MCP-README.md](MCP-README.md)。

## HTTP API

项目提供了完整的 HTTP API 接口，用于管理记忆系统。所有接口均运行在端口 3000 上。

### 可用接口

- `GET /login` - 获取会话
- `POST /add_memory` - 添加记忆
- `POST /get_memory` - 获取记忆
- `POST /update_memory` - 更新记忆内容
- `POST /update_memory_key` - 更新记忆键名

详细 API 文档请参考 [API.md](API.md)。

## Benchmark

```bash
bun run bench
bun run bench:kv
bun run bench:links
```
