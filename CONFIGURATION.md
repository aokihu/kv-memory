# 配置文档

本文档详细说明 kvdb-mem 系统的配置选项，包括搜索功能的配置。

## 目录
- [环境变量](#环境变量)
- [数据库配置](#数据库配置)
- [搜索功能配置](#搜索功能配置)
- [MCP 服务配置](#mcp-服务配置)
- [HTTP API 配置](#http-api-配置)
- [性能调优](#性能调优)
- [部署配置](#部署配置)

## 环境变量

### 通用配置

| 变量 | 默认值 | 说明 | 示例 |
|------|--------|------|------|
| `PORT` | `3000` | HTTP 服务监听端口 | `PORT=3000` |
| `NODE_ENV` | `development` | 运行环境：`development`、`production`、`test` | `NODE_ENV=production` |
| `LOG_LEVEL` | `info` | 日志级别：`error`、`warn`、`info`、`debug` | `LOG_LEVEL=debug` |
| `BUN_DEBUG` | (未设置) | Bun 运行时调试标志 | `BUN_DEBUG=1` |

### 数据库配置

| 变量 | 默认值 | 说明 | 示例 |
|------|--------|------|------|
| `KVDB_DATABASE_PATH` | `./kv.db` | SQLite 数据库文件路径 | `KVDB_DATABASE_PATH=/data/kv.db` |
| `KVDB_SESSION_DATABASE_PATH` | `./session.db` | 会话数据库文件路径 | `KVDB_SESSION_DATABASE_PATH=/data/session.db` |
| `KVDB_RESET_ON_START` | `false` | 启动时重置数据库（仅开发环境） | `KVDB_RESET_ON_START=true` |

### 搜索功能配置

| 变量 | 默认值 | 说明 | 示例 |
|------|--------|------|------|
| `KVDB_SEARCH_ENABLED` | `true` | 是否启用搜索功能 | `KVDB_SEARCH_ENABLED=true` |
| `KVDB_SEARCH_DEFAULT_LIMIT` | `20` | 默认搜索结果数量 | `KVDB_SEARCH_DEFAULT_LIMIT=50` |
| `KVDB_SEARCH_MAX_LIMIT` | `100` | 最大搜索结果数量 | `KVDB_SEARCH_MAX_LIMIT=200` |
| `KVDB_SEARCH_HIGHLIGHT_ENABLED` | `true` | 是否启用关键词高亮 | `KVDB_SEARCH_HIGHLIGHT_ENABLED=true` |

### MCP 服务配置

| 变量 | 默认值 | 说明 | 示例 |
|------|--------|------|------|
| `MCP_TRANSPORT` | `stdio` | 传输类型：`stdio`、`httpstream`、`http`、`sse` | `MCP_TRANSPORT=http` |
| `MCP_PORT` | `8787` | HTTP 流式服务监听端口 | `MCP_PORT=9000` |
| `MCP_HOST` | (未设置) | 绑定的主机地址 | `MCP_HOST=0.0.0.0` |
| `MCP_ENDPOINT` | `/mcp` | HTTP 流式服务的路径 | `MCP_ENDPOINT=/api/mcp` |
| `MCP_OUTPUT_FORMAT` | `toon` | 默认工具输出格式：`toon` 或 `json` | `MCP_OUTPUT_FORMAT=json` |

## 数据库配置

### SQLite 配置

kvdb-mem 使用 SQLite 作为存储后端，需要确保：

1. **FTS5 扩展支持**：SQLite 必须编译时启用 FTS5 支持
   ```bash
   # 检查 FTS5 支持
   sqlite3 :memory: "SELECT fts5(?1);"
   ```

2. **数据库文件权限**：确保应用有读写数据库文件的权限
   ```bash
   # 设置正确的权限
   chmod 644 kv.db
   chmod 644 session.db
   ```

3. **数据库位置**：生产环境建议使用绝对路径
   ```bash
   # 使用绝对路径
   export KVDB_DATABASE_PATH=/var/lib/kvdb-mem/kv.db
   export KVDB_SESSION_DATABASE_PATH=/var/lib/kvdb-mem/session.db
   ```

### 数据库初始化

系统启动时会自动初始化数据库：

```typescript
// 数据库初始化流程
1. 检查数据库文件是否存在
2. 如果不存在或 KVDB_RESET_ON_START=true，创建新数据库
3. 运行数据库迁移脚本
4. 创建必要的表和索引（包括 FTS5 表）
```

## 搜索功能配置

### 启用/禁用搜索

搜索功能默认启用，可以通过环境变量控制：

```bash
# 禁用搜索功能
export KVDB_SEARCH_ENABLED=false

# 启用搜索功能（默认）
export KVDB_SEARCH_ENABLED=true
```

### 搜索参数配置

```typescript
// 搜索服务配置接口
interface SearchConfig {
  enabled: boolean;           // 是否启用搜索
  defaultLimit: number;       // 默认结果数量
  maxLimit: number;          // 最大结果数量
  highlightEnabled: boolean;  // 是否启用高亮
}

// 默认配置
const defaultConfig: SearchConfig = {
  enabled: true,
  defaultLimit: 20,
  maxLimit: 100,
  highlightEnabled: true,
};
```

### FTS5 索引配置

搜索功能使用 SQLite FTS5 虚拟表：

```sql
-- FTS5 表结构
CREATE VIRTUAL TABLE memories_fts USING fts5(
  key UNINDEXED,      -- 文档ID（不索引）
  summary,            -- 摘要字段
  text,               -- 全文字段
  content='memories', -- 外部内容表
  content_rowid='rowid' -- 外部内容表的行ID
);

-- 自动同步触发器
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, key, summary, text)
  VALUES (new.rowid, new.key, new.summary, new.text);
END;
```

## MCP 服务配置

### 传输模式配置

#### STDIO 模式（默认）
```bash
# 默认配置
bun run mcp

# 或显式设置
MCP_TRANSPORT=stdio bun run mcp
```

#### HTTP 流式模式
```bash
# 基本配置
MCP_TRANSPORT=http bun run mcp

# 完整配置
MCP_TRANSPORT=http \
MCP_PORT=9000 \
MCP_HOST=0.0.0.0 \
MCP_ENDPOINT=/api/mcp \
bun run mcp
```

#### SSE 模式
```bash
# SSE 传输
MCP_TRANSPORT=sse bun run mcp
```

### 工具配置

MCP 工具可以通过环境变量配置：

```bash
# 设置默认输出格式为 JSON
export MCP_OUTPUT_FORMAT=json

# 设置默认输出格式为 TOON（人类可读）
export MCP_OUTPUT_FORMAT=toon
```

## HTTP API 配置

### 服务配置

```typescript
// HTTP 服务器配置
interface HttpServerConfig {
  port: number;           // 监听端口
  host?: string;          // 主机地址
  cors?: CorsOptions;     // CORS 配置
  bodyLimit?: string;     // 请求体大小限制
}

// 默认配置
const defaultHttpConfig: HttpServerConfig = {
  port: 3000,
  host: undefined, // 监听所有地址
  bodyLimit: '1mb',
};
```

### CORS 配置

如果需要跨域访问，可以配置 CORS：

```typescript
// 在生产环境中配置 CORS
const corsOptions = {
  origin: ['https://example.com', 'https://app.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
};
```

## 性能调优

### 数据库性能

1. **连接池配置**：SQLite 是文件数据库，连接池大小建议为 1
2. **WAL 模式**：启用 Write-Ahead Logging 提高并发性能
   ```sql
   PRAGMA journal_mode=WAL;
   PRAGMA synchronous=NORMAL;
   ```

3. **内存配置**：调整 SQLite 内存使用
   ```sql
   PRAGMA cache_size = -2000;  -- 2MB 缓存
   PRAGMA mmap_size = 268435456; -- 256MB mmap
   ```

### 搜索性能

1. **索引优化**：定期优化 FTS5 索引
   ```bash
   # 手动优化索引
   curl -X POST http://localhost:3000/admin/optimize-fts-index
   ```

2. **查询优化**：
   - 使用具体的查询词
   - 合理设置 limit 参数
   - 避免过于复杂的查询

3. **缓存策略**：对于高频查询，考虑添加应用层缓存

### 内存使用

```typescript
// Bun 运行时内存配置
// 在 package.json 中配置
{
  "scripts": {
    "start": "bun --max-old-space-size=4096 run index.ts"
  }
}
```

## 部署配置

### 开发环境

```bash
# .env.development
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
KVDB_RESET_ON_START=false
KVDB_SEARCH_ENABLED=true
```

### 测试环境

```bash
# .env.test
PORT=3000
NODE_ENV=test
LOG_LEVEL=info
KVDB_RESET_ON_START=true  # 测试环境每次重置
KVDB_SEARCH_ENABLED=true
KVDB_DATABASE_PATH=./test.db
```

### 生产环境

```bash
# .env.production
PORT=3000
NODE_ENV=production
LOG_LEVEL=warn
KVDB_RESET_ON_START=false
KVDB_SEARCH_ENABLED=true
KVDB_DATABASE_PATH=/var/lib/kvdb-mem/kv.db
KVDB_SESSION_DATABASE_PATH=/var/lib/kvdb-mem/session.db
KVDB_SEARCH_DEFAULT_LIMIT=50
KVDB_SEARCH_MAX_LIMIT=200
MCP_TRANSPORT=http
MCP_PORT=8787
MCP_HOST=0.0.0.0
```

### Docker 部署

```dockerfile
# Dockerfile 示例
FROM oven/bun:1.0-alpine

WORKDIR /app

# 复制依赖文件
COPY package.json bun.lockb ./
RUN bun install --production

# 复制应用代码
COPY . .

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV KVDB_DATABASE_PATH=/data/kv.db
ENV KVDB_SESSION_DATABASE_PATH=/data/session.db

# 创建数据目录
RUN mkdir -p /data

# 暴露端口
EXPOSE 3000 8787

# 启动命令
CMD ["bun", "run", "index.ts"]
```

### 系统服务配置

#### systemd 服务文件

```ini
# /etc/systemd/system/kvdb-mem.service
[Unit]
Description=KVDB Memory Service
After=network.target

[Service]
Type=simple
User=kvdb
WorkingDirectory=/opt/kvdb-mem
Environment="NODE_ENV=production"
Environment="PORT=3000"
Environment="KVDB_DATABASE_PATH=/var/lib/kvdb-mem/kv.db"
ExecStart=/usr/bin/bun run index.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 监控和日志

### 日志配置

```typescript
// 日志配置示例
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'combined.log' }),
  ],
});
```

### 健康检查

系统提供健康检查端点：

```bash
# 健康检查
curl http://localhost:3000/health

# 响应示例
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00Z",
  "services": {
    "database": "connected",
    "search": "enabled",
    "mcp": "running"
  }
}
```

### 性能监控

建议监控以下指标：

1. **API 响应时间**：各端点的平均响应时间
2. **搜索性能**：搜索查询的执行时间
3. **内存使用**：应用内存占用
4. **数据库性能**：SQLite 操作性能
5. **错误率**：各端点的错误率

## 安全配置

### 访问控制

1. **网络隔离**：生产环境应将服务部署在内网
2. **API 认证**：考虑添加 API 密钥认证（后续版本）
3. **输入验证**：所有输入都经过 Zod 验证

### 数据安全

1. **数据库加密**：考虑使用 SQLCipher 加密数据库（后续版本）
2. **敏感数据**：避免在记忆中存储敏感信息
3. **备份策略**：定期备份数据库文件

## 故障排除

### 常见配置问题

#### 1. 搜索功能不可用

```bash
# 检查配置
echo $KVDB_SEARCH_ENABLED

# 检查数据库
sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts';"

# 检查日志
tail -f logs/error.log
```

#### 2. MCP 服务无法启动

```bash
# 检查端口占用
netstat -tlnp | grep :8787

# 检查环境变量
env | grep MCP_

# 检查依赖
bun install
```

#### 3. 数据库权限问题

```bash
# 检查文件权限
ls -la kv.db session.db

# 修复权限
chown kvdb:kvdb kv.db session.db
chmod 644 kv.db session.db
```

### 配置验证脚本

```bash
#!/bin/bash
# config-validate.sh

echo "验证 kvdb-mem 配置..."

# 检查必需的环境变量
required_vars=("NODE_ENV" "PORT")
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "错误: 环境变量 $var 未设置"
    exit 1
  fi
done

# 检查数据库文件
if [ ! -f "$KVDB_DATABASE_PATH" ]; then
  echo "警告: 数据库文件不存在: $KVDB_DATABASE_PATH"
  echo "系统将在启动时创建新数据库"
fi

# 检查搜索配置
if [ "$KVDB_SEARCH_ENABLED" = "true" ]; then
  echo "搜索功能已启用"
  echo "默认结果数量: ${KVDB_SEARCH_DEFAULT_LIMIT:-20}"
  echo "最大结果数量: ${KVDB_SEARCH_MAX_LIMIT:-100}"
else
  echo "搜索功能已禁用"
fi

echo "配置验证完成"
```

## 更新日志

### 版本 1.0.0
- 初始版本，包含基础记忆管理功能
- 添加搜索功能配置选项
- 支持 FTS5 全文搜索
- 提供 MCP 服务配置

### 后续版本计划
- 添加 API 认证配置
- 支持数据库加密配置
- 添加高级搜索配置选项
- 支持集群部署配置

---

**注意**：配置更改后需要重启服务才能生效。