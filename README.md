# kvdb-mem

![GitHub Actions](https://github.com/aokihu/kv-memory/actions/workflows/release.yml/badge.svg)

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
- `GET /search` - 关键词搜索记忆
- `GET /fulltext` - 全文搜索记忆

详细 API 文档请参考 [API.md](API.md)。

## 搜索功能

项目提供了基于 SQLite FTS5 的全文搜索功能，支持：

### 搜索特性
- **关键词搜索**：支持中英文关键词搜索
- **全文搜索**：支持多关键词组合和逻辑运算符（AND/OR）
- **相关性排序**：搜索结果按相关性自动排序
- **分页支持**：支持 limit/offset 参数进行分页
- **关键词高亮**：搜索结果中自动高亮匹配的关键词

### 配置选项
搜索功能可以通过环境变量配置：
- `KVDB_SEARCH_ENABLED`：是否启用搜索功能（默认：true）
- `KVDB_SEARCH_DEFAULT_LIMIT`：默认搜索结果数量（默认：20）
- `KVDB_SEARCH_MAX_LIMIT`：最大搜索结果数量（默认：100）

### MCP 搜索工具
项目还提供了 MCP 搜索工具：
- `memory_search`：基础关键词搜索工具
- `memory_fulltext_search`：全文搜索工具

详细 MCP 工具文档请参考 [MCP-README.md](MCP-README.md)。

## Benchmark

```bash
bun run bench
bun run bench:kv
bun run bench:links
```

## 📦 Releases

### v2.0.0 - Major Timing System Refactor
- **All `setInterval` usage replaced with recursive `setTimeout`** for better timing control
- Fixed `Infinity` timeout parameter handling in decay processor
- Enhanced error handling and system stability
- Added standalone CLI tools for database maintenance

### Download Binary
```bash
# Download v2.0.0 binary
curl -L -o kvdb-mem https://github.com/aokihu/kv-memory/releases/download/v2.0.0/kvdb-mem

# Make executable
chmod +x kvdb-mem

# Verify checksum
echo "CHECKSUM_HERE  kvdb-mem" | sha256sum -c

# Move to PATH
sudo mv kvdb-mem /usr/local/bin/
```

### CLI Usage
```bash
# Show help
kvdb-mem --help

# Backup database
kvdb-mem backup

# Repair FTS5 index
kvdb-mem repair

# Check database integrity
kvdb-mem check
```

For detailed changelog, see [CHANGELOG.md](CHANGELOG.md)
