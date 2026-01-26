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

## MCP 服务端

项目还包含一个基于 `fastmcp` 构建的 MCP 服务端，实现了 session 管理、记忆的写入/读取、`memory://{key}` 资源和常用提示。更多使用方式与示例见 [MCP-README.md](MCP-README.md)。
