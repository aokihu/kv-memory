# 配置文档

本文档详细说明 kvdb-mem 系统的配置选项，包括搜索功能的配置。

## 目录
- [环境变量](#环境变量)
- [数据库配置](#数据库配置)
- [SQLite 崩溃安全配置](#sqlite-崩溃安全配置)
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

## SQLite 崩溃安全配置

本系统实现了完整的 SQLite 崩溃安全机制，确保在意外服务器终止（崩溃、断电、强制终止）时数据不会丢失。

### 崩溃安全核心功能

| 功能 | 描述 | 默认行为 |
|------|------|----------|
| **WAL 模式** | Write-Ahead Logging 确保写操作原子性和持久性 | 自动启用，启动时强制开启 |
| **同步模式** | 控制数据写入磁盘的时机 | `EXTRA` - 最高持久性级别 |
| **显式事务** | 所有写操作包裹在显式事务中 | 自动管理，失败自动回滚 |
| **安全关闭** | 关闭连接前执行 checkpoint 确保数据持久化 | 自动执行 TRUNCATE checkpoint |
| **崩溃恢复** | 启动时检测 WAL 残留文件并自动恢复 | 自动执行 checkpoint |
| **定期 Checkpoint** | 防止 WAL 文件无限制增长 | 默认每 60 秒执行一次 |
| **完整性检查** | 启动时验证数据库文件完整性 | 默认关闭，可配置开启 |

### 崩溃安全环境变量

| 环境变量 | 默认值 | 可选值 | 说明 |
|----------|--------|--------|------|
| `KVDB_SQLITE_SYNCHRONOUS` | `EXTRA` | `OFF`, `NORMAL`, `FULL`, `EXTRA` | SQLite 同步模式。EXTRA 提供最高持久性保证 |
| `KVDB_SQLITE_JOURNAL_MODE` | `WAL` | `DELETE`, `TRUNCATE`, `PERSIST`, `MEMORY`, `OFF`, `WAL` | 日志模式。WAL 提供最佳并发性能和崩溃恢复能力 |
| `KVDB_SQLITE_BUSY_TIMEOUT_MS` | `5000` | 任意非负整数 | 等待锁释放的超时时间（毫秒） |
| `KVDB_SQLITE_FOREIGN_KEYS` | `on` | `on`, `off` | 是否启用外键约束 |
| `KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS` | `60000` | 任意非负整数 | 定期执行 `PRAGMA wal_checkpoint(TRUNCATE)` 的间隔（毫秒）。设为 0 禁用 |
| `KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP` | `OFF` | `OFF`, `QUICK`, `FULL` | 启动时执行的完整性检查模式 |

### `wal_autocheckpoint` 说明

当前实现没有暴露 `PRAGMA wal_autocheckpoint` 对应的环境变量，而是通过
`KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS` 执行固定周期 `TRUNCATE` checkpoint。

这样做的原因是：

- 能覆盖启动恢复与安全关闭两个固定生命周期点
- 能直接控制 WAL 文件截断行为，便于运维观察文件大小

如果你的运维策略必须使用 SQLite 页数阈值自动 checkpoint，可在维护脚本中手动执行：

```sql
PRAGMA wal_autocheckpoint = 1000;
```

> 注意：手动设置 `wal_autocheckpoint` 时，建议同步评估是否仍保留
> `KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS`，避免两种策略叠加造成额外 I/O 抖动。

### 配置示例

#### 开发环境配置
```bash
# .env.development - 开发环境平衡性能和持久性
KVDB_SQLITE_SYNCHRONOUS=NORMAL
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=30000
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=OFF
```

#### 生产环境高持久性配置
```bash
# .env.production - 生产环境最高持久性
KVDB_SQLITE_SYNCHRONOUS=EXTRA
KVDB_SQLITE_JOURNAL_MODE=WAL
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=QUICK
KVDB_SQLITE_BUSY_TIMEOUT_MS=10000
```

#### 最大性能配置（测试环境）
```bash
# 测试环境 - 最大性能，持久性可接受一定损失
KVDB_SQLITE_SYNCHRONOUS=NORMAL
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=10000
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=OFF
```

#### 关键任务数据保护配置
```bash
# 金融级数据保护 - 最高安全级别
KVDB_SQLITE_SYNCHRONOUS=EXTRA
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=30000
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=FULL
KVDB_SQLITE_BUSY_TIMEOUT_MS=30000
```

### 最佳实践

1. **选择合适的同步模式**
   - **开发/测试**：使用 `NORMAL` 获得更好性能
   - **生产环境**：使用 `EXTRA` 确保最高数据安全
   - **关键任务**：使用 `EXTRA` 配合 `FULL` 完整性检查

2. **定期 Checkpoint 调优**
   - 默认 60 秒适合大多数场景
   - 写入密集场景：减小到 30 秒防止 WAL 过大
   - 写入稀疏场景：增大到 5 分钟减少 I/O
   - 设为 0 可禁用（不推荐生产环境）

3. **完整性检查策略**
   - `OFF`：启动最快，不检查（推荐常规生产部署）
   - `QUICK`：快速检查关键结构，开销小（推荐首次部署/升级后）
   - `FULL`：全面检查，耗时较长（推荐数据恢复后或定期维护窗口）

4. **监控关键指标**
    - WAL 文件大小增长趋势
    - Checkpoint 执行频率和耗时
    - 启动恢复事件次数
    - 完整性检查结果

5. **`integrity_check` 启用策略**
   - 常规生产：`KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=OFF`
   - 版本升级后首启：`QUICK`
   - 数据修复后验证：`FULL`（建议仅在维护窗口）

### 故障排查

#### 问题：WAL 文件过大
**原因**：Checkpoint 间隔过长或写入量过大  
**解决**：
1. 减小 `KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS`
2. 手动触发 checkpoint：`PRAGMA wal_checkpoint(TRUNCATE)`
3. 检查是否有长期未完成的事务

#### 问题：性能突然下降
**原因**：同步模式设置为 FULL/EXTRA 导致磁盘 I/O 增加  
**解决**：
1. 评估数据安全性需求，考虑降至 NORMAL
2. 使用 SSD 存储提升 I/O 性能
3. 调整 `busy_timeout` 减少锁等待

#### 问题：启动时长时间挂起
**原因**：完整性检查设置为 FULL 且数据库较大  
**解决**：
1. 临时设置 `KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=OFF`
2. 或改为 `QUICK` 模式进行快速检查
3. 在维护窗口手动执行完整检查

#### 问题：检测到启动恢复日志
**原因**：上次关闭异常（崩溃、强制终止）  
**解决**：
1. 检查系统日志确认上次关闭原因
2. 验证数据一致性（运行完整性检查）
3. 检查磁盘空间和文件系统健康状态
4. 考虑启用更频繁的 checkpoint

### 高级配置

#### 自定义 PRAGMA 设置
系统通过以下 PRAGMA 实现崩溃安全（由系统自动管理，通常无需手动设置）：

```sql
-- WAL 模式（必须）
PRAGMA journal_mode = WAL;

-- 同步级别（数据持久化保证）
PRAGMA synchronous = EXTRA;  -- 可选: OFF, NORMAL, FULL, EXTRA

-- 锁等待超时
PRAGMA busy_timeout = 5000;  -- 毫秒

-- 缓存大小
PRAGMA cache_size = -64000;  -- 64MB (负值表示页数)

-- 临时表存储位置
PRAGMA temp_store = MEMORY;  -- 提升性能，但增加内存使用

-- 外键约束
PRAGMA foreign_keys = ON;

-- Checkpoint 操作
PRAGMA wal_checkpoint(TRUNCATE);  -- 完全截断 WAL 文件
```

**注意**：以上 PRAGMA 由系统自动应用，通常无需手动执行。如需自定义，请使用对应的环境变量。

### 实现与测试依据

- 配置解析：`src/libs/kv/db/config.ts`
- PRAGMA 应用与 checkpoint 生命周期：`src/libs/kv/db/schema.ts`
- 完整性检查工具：`src/libs/kv/db/integrity.ts`
- 配置解析测试：`tests/db.config.test.ts`
- PRAGMA 与 checkpoint 生命周期测试：`tests/db.schema.test.ts`
- 完整性检查测试：`tests/db.integrity.test.ts`

### 相关文档

- [部署指南](docs/DEPLOYMENT_GUIDE.md) - 生产环境部署详细指南
- [WAL 监控指南](docs/WAL_MONITORING.md) - WAL 文件监控和告警配置
- [故障排除指南](docs/SQLITE_CRASH_SAFETY_TROUBLESHOOTING.md) - 常见问题和解决方案
- [SQLite 官方文档 - WAL 模式](https://sqlite.org/wal.html)
- [SQLite 官方文档 - PRAGMA 同步](https://sqlite.org/pragma.html#pragma_synchronous)

## 数据库初始化

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

3. **崩溃安全性能调优**：

   | 同步模式 | 持久性 | 相对性能 | 推荐场景 |
   |----------|--------|----------|----------|
   | `OFF` | 无保证 | 最快 | 临时数据、缓存 |
   | `NORMAL` | 一般 | 快 | 开发环境、可接受少量数据丢失 |
   | `FULL` | 高 | 中等 | 生产环境关键数据 |
   | `EXTRA` | 最高 | 较慢 | 金融级、关键任务数据（默认） |

   ```sql
   -- 性能优先（开发/测试）
   PRAGMA synchronous=NORMAL;
   
   -- 持久性优先（生产环境）
   PRAGMA synchronous=EXTRA;
   ```

4. **Checkpoint 频率调优**：

   | 场景 | 推荐间隔 | 说明 |
   |------|----------|------|
   | 低写入负载 | 300000 (5分钟) | 减少 I/O 开销 |
   | 中等写入负载 | 60000 (1分钟) | 默认配置 |
   | 高写入负载 | 30000 (30秒) | 防止 WAL 文件过大 |
   | 极端写入负载 | 10000 (10秒) | 需配合 SSD 使用 |

5. **内存配置**：调整 SQLite 内存使用
   ```sql
   PRAGMA cache_size = -64000;  -- 64MB 缓存（系统默认）
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

### 环境变量配置模板

#### 开发环境

```bash
# .env.development
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
KVDB_RESET_ON_START=false
KVDB_SEARCH_ENABLED=true

# SQLite 崩溃安全（开发环境平衡性能与持久性）
KVDB_SQLITE_SYNCHRONOUS=NORMAL
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=30000
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=OFF
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

# SQLite 崩溃安全（测试环境最大性能）
KVDB_SQLITE_SYNCHRONOUS=NORMAL
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=10000
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=OFF
KVDB_SQLITE_BUSY_TIMEOUT_MS=5000
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

# SQLite 崩溃安全配置（生产环境最高持久性）
# 同步模式: EXTRA 提供最高级别的数据持久性保证
KVDB_SQLITE_SYNCHRONOUS=EXTRA
# 日志模式: WAL 提供最佳并发性能和崩溃恢复能力
KVDB_SQLITE_JOURNAL_MODE=WAL
# 定期 checkpoint 间隔: 60秒（防止 WAL 文件过大）
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000
# 启动时完整性检查: QUICK 模式（快速验证数据库结构）
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=QUICK
# 锁等待超时: 10秒（生产环境建议适当增加）
KVDB_SQLITE_BUSY_TIMEOUT_MS=10000
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

# SQLite 崩溃安全配置（生产环境推荐）
ENV KVDB_SQLITE_SYNCHRONOUS=EXTRA
ENV KVDB_SQLITE_JOURNAL_MODE=WAL
ENV KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000
ENV KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=QUICK
ENV KVDB_SQLITE_BUSY_TIMEOUT_MS=10000

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
