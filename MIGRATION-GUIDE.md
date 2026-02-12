# 迁移指南

本文档提供从旧版本升级到包含搜索功能的新版本的迁移指南。

## 目录
- [版本兼容性](#版本兼容性)
- [从 v0.x 升级到 v1.0](#从-v0x-升级到-v10)
- [数据库迁移](#数据库迁移)
- [API 变更](#api-变更)
- [MCP 工具变更](#mcp-工具变更)
- [配置变更](#配置变更)
- [回滚指南](#回滚指南)
- [常见问题](#常见问题)

## 版本兼容性

### 版本矩阵

| 功能 | v0.x | v1.0 | 变更类型 |
|------|------|------|----------|
| 基础记忆管理 | ✅ | ✅ | 兼容 |
| 记忆链接 | ✅ | ✅ | 兼容 |
| HTTP API | ✅ | ✅ | 向后兼容 |
| MCP 工具 | ✅ | ✅ | 向后兼容 |
| 搜索功能 | ❌ | ✅ | 新增功能 |
| FTS5 索引 | ❌ | ✅ | 新增功能 |

### 升级路径

- **v0.x → v1.0**：直接升级，无破坏性变更
- **v1.0 → v1.x**：向后兼容升级
- **降级到 v0.x**：需要删除 FTS5 相关表

## 从 v0.x 升级到 v1.0

### 升级步骤

#### 1. 备份数据

在升级前，务必备份现有数据：

```bash
# 备份数据库文件
cp kv.db kv.db.backup.$(date +%Y%m%d)
cp session.db session.db.backup.$(date +%Y%m%d)

# 或者使用 SQLite 备份命令
sqlite3 kv.db ".backup kv.db.backup"
sqlite3 session.db ".backup session.db.backup"
```

#### 2. 更新代码

```bash
# 拉取最新代码
git pull origin main

# 或下载新版本
wget https://github.com/your-org/kvdb-mem/releases/download/v1.0.0/kvdb-mem-v1.0.0.tar.gz
tar -xzf kvdb-mem-v1.0.0.tar.gz
cd kvdb-mem-v1.0.0
```

#### 3. 安装依赖

```bash
# 安装新依赖
bun install

# 检查新依赖
grep -A5 -B5 "fts5" package.json
```

#### 4. 运行数据库迁移

```bash
# 启动服务（自动运行迁移）
bun run dev

# 或手动运行迁移
bun run migrate
```

#### 5. 验证升级

```bash
# 检查服务状态
curl http://localhost:3000/health

# 检查搜索功能
curl "http://localhost:3000/search?q=test"

# 检查 MCP 工具
echo '{"tool": "memory_search", "arguments": {"query": "test"}}' | bun run mcp
```

### 升级检查清单

- [ ] 备份现有数据库
- [ ] 更新代码到 v1.0
- [ ] 安装新依赖
- [ ] 运行数据库迁移
- [ ] 验证服务启动
- [ ] 测试搜索功能
- [ ] 测试 MCP 工具
- [ ] 更新配置文件（如果需要）

## 数据库迁移

### 自动迁移

v1.0 版本包含自动数据库迁移：

```typescript
// 数据库迁移流程
1. 检查当前数据库版本
2. 如果版本 < 1.0，执行迁移脚本
3. 创建 FTS5 表和触发器
4. 更新数据库版本号
```

### 手动迁移

如果需要手动迁移，可以执行以下 SQL：

```sql
-- 1. 创建 FTS5 虚拟表
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  key UNINDEXED,
  summary,
  text,
  content='memories',
  content_rowid='rowid'
);

-- 2. 创建同步触发器
-- INSERT 触发器
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, key, summary, text)
  VALUES (new.rowid, new.key, new.summary, new.text);
END;

-- UPDATE 触发器
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, key, summary, text)
  VALUES ('delete', old.rowid, old.key, old.summary, old.text);
  INSERT INTO memories_fts(rowid, key, summary, text)
  VALUES (new.rowid, new.key, new.summary, new.text);
END;

-- DELETE 触发器
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, key, summary, text)
  VALUES ('delete', old.rowid, old.key, old.summary, old.text);
END;

-- 3. 初始化现有数据
INSERT INTO memories_fts(rowid, key, summary, text)
SELECT rowid, key, summary, text FROM memories;

-- 4. 创建索引维护表
CREATE TABLE IF NOT EXISTS db_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. 记录迁移版本
INSERT OR REPLACE INTO db_migrations (version) VALUES ('1.0.0');
```

### 迁移验证

验证迁移是否成功：

```bash
# 检查 FTS5 表是否存在
sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts';"

# 检查触发器
sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memories_%';"

# 检查数据同步
sqlite3 kv.db "SELECT COUNT(*) FROM memories;"
sqlite3 kv.db "SELECT COUNT(*) FROM memories_fts;"

# 检查迁移记录
sqlite3 kv.db "SELECT * FROM db_migrations ORDER BY applied_at DESC LIMIT 5;"
```

### 大型数据库迁移

对于包含大量数据的数据库，迁移可能需要较长时间：

```bash
# 估算迁移时间
sqlite3 kv.db "SELECT COUNT(*) FROM memories;"

# 分批次迁移（手动）
sqlite3 kv.db <<EOF
-- 禁用触发器临时
DROP TRIGGER memories_ai;
DROP TRIGGER memories_au;
DROP TRIGGER memories_ad;

-- 分批次插入
INSERT INTO memories_fts(rowid, key, summary, text)
SELECT rowid, key, summary, text FROM memories
WHERE rowid % 10 = 0;  -- 示例：每次插入10%的数据

-- 重新创建触发器
-- ...（重新创建触发器的SQL）
EOF
```

## API 变更

### 新增 API 端点

v1.0 新增了以下 API 端点：

| 端点 | 方法 | 描述 | 版本 |
|------|------|------|------|
| `/search` | GET | 关键词搜索 | v1.0+ |
| `/fulltext` | GET | 全文搜索 | v1.0+ |
| `/admin/optimize-fts-index` | POST | 优化 FTS5 索引 | v1.0+ |
| `/admin/rebuild-fts-index` | POST | 重建 FTS5 索引 | v1.0+ |

### 请求参数变更

无破坏性变更，现有 API 参数保持不变。

### 响应格式变更

搜索 API 使用新的响应格式：

```json
{
  "status": "ok",
  "data": {
    "results": [...],
    "pagination": {...}
  }
}
```

现有 API 的响应格式保持不变。

### 错误代码变更

新增搜索相关的错误代码：

| HTTP 状态码 | 错误代码 | 描述 | 版本 |
|------------|----------|------|------|
| 400 | `invalid_operator` | 无效的逻辑运算符 | v1.0+ |
| 400 | `invalid_limit_offset` | 无效的分页参数 | v1.0+ |
| 500 | `search_disabled` | 搜索功能未启用 | v1.0+ |

## MCP 工具变更

### 新增 MCP 工具

v1.0 新增了以下 MCP 工具：

| 工具名称 | 描述 | 版本 |
|----------|------|------|
| `memory_search` | 基础关键词搜索 | v1.0+ |
| `memory_fulltext_search` | 全文搜索 | v1.0+ |

### 工具参数变更

现有 MCP 工具参数保持不变。

### 工具响应变更

搜索工具使用新的响应格式：

```json
{
  "success": true,
  "data": {
    "results": [...],
    "pagination": {...}
  }
}
```

现有工具的响应格式保持不变。

## 配置变更

### 新增环境变量

v1.0 新增了以下环境变量：

| 变量 | 默认值 | 描述 | 版本 |
|------|--------|------|------|
| `KVDB_SEARCH_ENABLED` | `true` | 是否启用搜索功能 | v1.0+ |
| `KVDB_SEARCH_DEFAULT_LIMIT` | `20` | 默认搜索结果数量 | v1.0+ |
| `KVDB_SEARCH_MAX_LIMIT` | `100` | 最大搜索结果数量 | v1.0+ |
| `KVDB_SEARCH_HIGHLIGHT_ENABLED` | `true` | 是否启用关键词高亮 | v1.0+ |

### 配置示例

#### 开发环境配置

```bash
# .env.development
PORT=3000
NODE_ENV=development
KVDB_SEARCH_ENABLED=true
KVDB_SEARCH_DEFAULT_LIMIT=20
KVDB_SEARCH_MAX_LIMIT=100
```

#### 生产环境配置

```bash
# .env.production
PORT=3000
NODE_ENV=production
KVDB_SEARCH_ENABLED=true
KVDB_SEARCH_DEFAULT_LIMIT=50
KVDB_SEARCH_MAX_LIMIT=200
KVDB_SEARCH_HIGHLIGHT_ENABLED=true
```

#### 禁用搜索功能

```bash
# 禁用搜索
KVDB_SEARCH_ENABLED=false
```

## 回滚指南

### 回滚到 v0.x

如果需要回滚到 v0.x 版本：

#### 1. 停止服务

```bash
# 停止当前服务
pkill -f "bun run"
```

#### 2. 恢复代码

```bash
# 恢复到旧版本代码
git checkout v0.9.0

# 或下载旧版本
wget https://github.com/your-org/kvdb-mem/releases/download/v0.9.0/kvdb-mem-v0.9.0.tar.gz
tar -xzf kvdb-mem-v0.9.0.tar.gz
cd kvdb-mem-v0.9.0
```

#### 3. 清理 FTS5 相关表

```bash
# 删除 FTS5 表和触发器
sqlite3 kv.db <<EOF
DROP TRIGGER IF EXISTS memories_ai;
DROP TRIGGER IF EXISTS memories_au;
DROP TRIGGER IF EXISTS memories_ad;
DROP TABLE IF EXISTS memories_fts;
DELETE FROM db_migrations WHERE version = '1.0.0';
EOF
```

#### 4. 恢复依赖

```bash
# 安装旧版本依赖
bun install
```

#### 5. 启动服务

```bash
# 启动旧版本服务
bun run dev
```

### 回滚检查清单

- [ ] 停止当前服务
- [ ] 恢复旧版本代码
- [ ] 删除 FTS5 相关表
- [ ] 恢复旧版本依赖
- [ ] 启动旧版本服务
- [ ] 验证功能正常

## 常见问题

### Q1: 升级后搜索功能不可用

**问题描述**：升级到 v1.0 后，搜索 API 返回错误或空结果。

**解决方案**：
1. 检查 FTS5 表是否创建成功
   ```bash
   sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts';"
   ```

2. 检查数据是否同步
   ```bash
   sqlite3 kv.db "SELECT COUNT(*) FROM memories;"
   sqlite3 kv.db "SELECT COUNT(*) FROM memories_fts;"
   ```

3. 检查搜索功能是否启用
   ```bash
   echo $KVDB_SEARCH_ENABLED
   ```

4. 手动重建索引
   ```bash
   curl -X POST http://localhost:3000/admin/rebuild-fts-index
   ```

### Q2: 升级后性能下降

**问题描述**：升级后数据库操作变慢。

**解决方案**：
1. 优化 FTS5 索引
   ```bash
   curl -X POST http://localhost:3000/admin/optimize-fts-index
   ```

2. 调整 SQLite 配置
   ```sql
   PRAGMA journal_mode=WAL;
   PRAGMA synchronous=NORMAL;
   PRAGMA cache_size = -2000;
   ```

3. 检查触发器性能
   ```bash
   # 检查触发器数量
   sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='trigger';"
   ```

### Q3: 升级后现有 API 不兼容

**问题描述**：现有客户端调用 API 失败。

**解决方案**：
1. 检查 API 响应格式
   ```bash
   curl -v http://localhost:3000/add_memory
   ```

2. 验证现有端点
   ```bash
   # 测试所有现有端点
   curl http://localhost:3000/login
   curl -X POST http://localhost:3000/add_memory -d '{"key":"test","value":{"summary":"test","text":"test"}}'
   curl -X POST http://localhost:3000/get_memory -d '{"key":"test"}'
   ```

3. 检查日志中的错误信息
   ```bash
   tail -f logs/error.log
   ```

### Q4: 数据库迁移失败

**问题描述**：数据库迁移过程中出现错误。

**解决方案**：
1. 检查数据库文件权限
   ```bash
   ls -la kv.db
   chmod 644 kv.db
   ```

2. 检查 SQLite 版本
   ```bash
   sqlite3 --version
   # 需要 SQLite 3.9.0+ 支持 FTS5
   ```

3. 手动执行迁移 SQL
   ```bash
   # 参考"手动迁移"部分
   sqlite3 kv.db < migration.sql
   ```

4. 从备份恢复
   ```bash
   cp kv.db.backup kv.db
   ```

### Q5: MCP 工具不可用

**问题描述**：升级后 MCP 工具无法使用。

**解决方案**：
1. 检查 MCP 服务状态
   ```bash
   bun run mcp
   ```

2. 检查工具注册
   ```bash
   grep -n "memory_search" src/mcp/server.ts
   ```

3. 检查客户端连接
   ```bash
   # 测试 MCP 连接
   echo '{"tool": "session_new", "arguments": {}}' | bun run mcp
   ```

### Q6: 内存使用增加

**问题描述**：升级后应用内存使用明显增加。

**解决方案**：
1. 检查 FTS5 索引大小
   ```bash
   sqlite3 kv.db "SELECT page_count * page_size as size FROM pragma_page_count, pragma_page_size;"
   ```

2. 调整缓存配置
   ```bash
   # 减少 SQLite 缓存
   export SQLITE_CACHE_SIZE=1000
   ```

3. 监控内存使用
   ```bash
   # 使用 top 或 htop 监控
   top -p $(pgrep -f "bun run")
   ```

## 升级后验证

### 功能验证清单

- [ ] 基础记忆管理功能正常
- [ ] 记忆链接功能正常
- [ ] HTTP API 所有端点正常
- [ ] MCP 工具所有工具正常
- [ ] 搜索功能正常
- [ ] 关键词搜索正常
- [ ] 全文搜索正常
- [ ] 搜索结果高亮正常
- [ ] 分页功能正常
- [ ] 索引维护功能正常

### 性能验证

- [ ] API 响应时间在可接受范围
- [ ] 搜索查询性能良好
- [ ] 内存使用在预期范围内
- [ ] 数据库操作性能正常

### 集成验证

- [ ] 现有客户端集成正常
- [ ] 第三方工具集成正常
- [ ] 监控系统数据正常
- [ ] 日志系统记录正常

## 支持与帮助

### 获取帮助

如果在升级过程中遇到问题：

1. **查看文档**：
   - [README.md](README.md)
   - [API.md](API.md)
   - [MCP-README.md](MCP-README.md)
   - [SEARCH-GUIDE.md](SEARCH-GUIDE.md)

2. **检查日志**：
   ```bash
   tail -f logs/error.log
   tail -f logs/combined.log
   ```

3. **启用调试模式**：
   ```bash
   export LOG_LEVEL=debug
   export BUN_DEBUG=1
   bun run dev
   ```

4. **提交 Issue**：
   - GitHub Issues: https://github.com/your-org/kvdb-mem/issues
   - 提供详细的错误信息和日志

### 联系支持

- **电子邮件**：support@example.com
- **Discord**：https://discord.gg/example
- **文档**：https://docs.example.com/kvdb-mem

---

**注意**：在生产环境升级前，务必在测试环境充分测试。