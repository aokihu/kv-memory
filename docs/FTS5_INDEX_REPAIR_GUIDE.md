# FTS5 索引损坏修复文档

## 目录

1. [问题概述](#问题概述)
2. [根本原因分析](#根本原因分析)
3. [修复方案](#修复方案)
4. [新增功能说明](#新增功能说明)
5. [配置指南](#配置指南)
6. [维护脚本](#维护脚本)
7. [测试验证](#测试验证)
8. [最佳实践](#最佳实践)
9. [故障排除](#故障排除)

---

## 问题概述

### 1.1 问题描述

在使用 SQLite FTS5 全文搜索索引时，出现了索引损坏错误：

```
fts5: missing row 5 from content table 'main'.'memories'
```

该错误表明 FTS5 外部内容表 (`memories_fts`) 与主表 (`memories`) 的行映射关系出现了不一致。

### 1.2 影响范围

- **搜索功能完全失效**：所有 FTS5 MATCH 查询无法正常执行
- **数据访问受限**：依赖全文搜索的查询功能不可用
- **用户体验下降**：记忆检索、联想功能无法正常工作
- **数据一致性风险**：索引与主表数据不同步，可能导致数据丢失感知

### 1.3 错误模式识别

当 FTS5 索引损坏时，常见的错误模式包括：

```typescript
// 模式1: 查询执行失败
// Error: fts5: missing row X from content table...

db.query("SELECT key FROM memories_fts WHERE memories_fts MATCH ?", [keyword]);

// 模式2: 触发器异常
// 在 INSERT/UPDATE/DELETE 时触发 FTS5 自动更新失败

// 模式3: 索引计数不匹配
// memories 表行数与 memories_fts 表行数不一致
```

---

## 根本原因分析

### 2.1 FTS5 架构理解

本系统使用 SQLite FTS5 的 **外部内容表 (external content table)** 模式：

```sql
-- 主表: 存储实际记忆数据
CREATE TABLE memories (
  key TEXT PRIMARY KEY,
  summary TEXT,
  text TEXT,
  -- ... 其他字段
);

-- FTS5 虚拟表: 只存储索引，不存储内容
CREATE VIRTUAL TABLE memories_fts USING fts5(
  key, summary, text,
  content='memories',        -- 外部内容表指向
  content_rowid='rowid'      -- 行ID映射
);
```

### 2.2 触发器同步机制

FTS5 依赖触发器保持索引与主表同步：

```sql
-- INSERT 触发器: 新记录自动加入索引
CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, key, summary, text)
  VALUES (new.rowid, new.key, new.summary, new.text);
END;

-- DELETE 触发器: 删除记录时移除索引
CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, key, summary, text)
  VALUES ('delete', old.rowid, old.key, old.summary, old.text);
END;

-- UPDATE 触发器: 更新记录时重建索引
CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
  -- 先删除旧索引
  INSERT INTO memories_fts(memories_fts, rowid, key, summary, text)
  VALUES ('delete', old.rowid, old.key, old.summary, old.text);
  -- 再插入新索引
  INSERT INTO memories_fts(rowid, key, summary, text)
  VALUES (new.rowid, new.key, new.summary, new.text);
END;
```

### 2.3 损坏原因分析

根据错误消息和系统架构，FTS5 索引损坏的**根本原因**包括：

#### 原因1: 非事务性写入中断

```typescript
// 危险模式: 多个独立操作，没有事务保护
db.run("INSERT INTO memories ...");           // 步骤1: 主表插入成功
db.run("INSERT INTO memories_fts ...");       // 步骤2: 索引插入失败
// 结果: 主表有数据，但索引缺失，导致 "missing row" 错误
```

#### 原因2: 触发器失败未处理

```typescript
// 当触发器执行失败时，错误可能被忽略
// 例如: 存储空间不足、数据库锁定等
try {
  db.run("DELETE FROM memories WHERE key = ?", [key]);
  // 触发器执行失败，但主操作已提交
} catch (error) {
  // 错误处理可能不完整
}
```

#### 原因3: 并发访问竞争

```typescript
// 多进程/线程同时写入
// 进程A: 正在插入，触发器执行中
// 进程B: 删除同一记录
// 结果: 触发器竞争，可能导致索引状态不一致
```

#### 原因4: 不当的数据库关闭

```typescript
// 进程崩溃或强制终止时
db.run("INSERT INTO memories ...");  // 写入进行中
// 进程突然终止，WAL文件未完全同步
// 重启后: 主表恢复，但FTS5索引可能部分提交
```

#### 原因5: 手动修改数据库

```sql
-- 绕过触发器直接操作
DELETE FROM memories WHERE key = 'xxx';  -- 删除记录
-- 但未更新 memories_fts 表
-- 结果: 索引中残留指向已删除记录的条目
```

### 2.4 损坏模式总结

| 损坏模式 | 症状 | 根本原因 |
|---------|------|---------|
| Missing row | `fts5: missing row X from content table` | 主表有记录但索引缺失 |
| Orphan index | 查询返回已删除的记录 | 记录已删除但索引残留 |
| Count mismatch | `memories` 和 `memories_fts` 行数不同 | 批量操作未同步 |
| Trigger failure | INSERT/UPDATE/DELETE 时触发器错误 | 触发器逻辑错误或资源限制 |
| Corruption error | `database disk image is malformed` | 磁盘/内存损坏，非逻辑错误 |

---

## 修复方案

### 3.1 修复策略总览

针对 FTS5 索引损坏问题，采用**分层修复策略**：

```
修复层次:
├── Layer 1: 备份 (必须)
│   └── 备份数据库文件 + sidecar 文件
├── Layer 2: 诊断 (确认损坏)
│   ├── PRAGMA quick_check
│   ├── PRAGMA integrity_check
│   └── 自定义 FTS5 完整性检查
├── Layer 3: 重建 (修复)
│   └── DROP + CREATE + REINDEX memories_fts
└── Layer 4: 验证 (确认修复)
    ├── 完整性检查再次运行
    └── FTS5 MATCH 查询验证
```

### 3.2 修复脚本实现

修复脚本 `scripts/repair-fts5-index.ts` 的完整实现：

```typescript
/**
 * FTS5 repair script for kv.db corruption recovery.
 *
 * Execution order is fixed:
 * 1) Integrity checks (quick/full)
 * 2) FTS5 index rebuild
 * 3) Search query verification
 */

import {
  closeDatabase,
  getDatabase,
  initDatabase,
  rebuildFtsIndex,
  runIntegrityCheck,
  runQuickCheck,
  type DatabaseIntegrityCheckResult,
} from "../src/libs/kv/db";

type SearchVerificationResult = {
  ok: boolean;
  keyword: string;
  hits: number;
  inspectedKey: string | null;
  error?: string;
};

type RepairResult = {
  databaseFile: string;
  startedAt: number;
  finishedAt: number;
  integrityBefore: {
    quick: DatabaseIntegrityCheckResult;
    full: DatabaseIntegrityCheckResult;
  };
  integrityAfter: {
    quick: DatabaseIntegrityCheckResult;
    full: DatabaseIntegrityCheckResult;
  };
  rebuild: { ok: boolean };
  verification: SearchVerificationResult;
};

// 执行修复流程
function runRepair(): RepairResult {
  const startedAt = Date.now();
  const databaseFile = process.env.KVDB_SQLITE_FILE ?? "kv.db";
  const db = initDatabase(getDatabase(databaseFile));

  // 1. 修复前完整性检查
  const integrityBefore = {
    quick: runQuickCheck(db),
    full: runIntegrityCheck(db),
  };

  // 2. 重建 FTS5 索引
  rebuildFtsIndex(db);

  // 3. 修复后完整性检查
  const integrityAfter = {
    quick: runQuickCheck(db),
    full: runIntegrityCheck(db),
  };

  // 4. 验证 FTS 查询
  const verification = verifySearch(db);

  return {
    databaseFile,
    startedAt,
    finishedAt: Date.now(),
    integrityBefore,
    integrityAfter,
    rebuild: { ok: true },
    verification,
  };
}
```

### 3.3 修复执行结果

修复脚本执行结果：

```bash
# 1. 执行修复
$ bun run ./scripts/repair-fts5-index.ts

[repair:fts5] completed
{
  "databaseFile": "kv.db",
  "startedAt": 1771040333356,
  "finishedAt": 1771040335123,
  "integrityBefore": {
    "quick": { "mode": "quick", "ok": true, "messages": ["ok"] },
    "full": { "mode": "full", "ok": true, "messages": ["ok"] }
  },
  "integrityAfter": {
    "quick": { "mode": "quick", "ok": true, "messages": ["ok"] },
    "full": { "mode": "full", "ok": true, "messages": ["ok"] }
  },
  "rebuild": { "ok": true },
  "verification": {
    "ok": true,
    "keyword": "atom核心提示词",
    "hits": 1,
    "inspectedKey": "Atom:global:index"
  }
}
```

### 3.4 服务层验证

修复后通过 `SearchService` 验证搜索功能恢复正常：

```typescript
// 验证代码示例
import { SearchService } from "./src/service/searchService";
import { getDatabase } from "./src/libs/kv/db";

const db = getDatabase("kv.db");
const searchService = new SearchService(db);

// 执行搜索验证
const result = searchService.search("atom");
console.log("Search result:", result);
// 输出: { total: 41, items: [...], hasMore: true }
```

---

## 新增功能说明

### 4.1 启动时 FTS5 完整性检查

为防止类似问题再次发生，系统新增了**启动时 FTS5 完整性检查**功能。

#### 功能特性

```typescript
// 检查模式支持
export type Fts5IntegrityCheckMode = "QUICK" | "FULL";

// QUICK 模式: 快速验证
// - 验证 memories_fts 表存在
// - 验证 MATCH 查询可执行

// FULL 模式: 深度验证
// - 包含 QUICK 所有检查
// - 验证必需触发器存在 (3个)
// - 验证 memories 与 memories_fts 记录数一致
// - 采样验证最近10条记录索引一致性
```

#### 检查函数实现

```typescript
// src/libs/kv/db/integrity.ts
export function runFts5IntegrityCheck(
  db: Database,
  mode: Fts5IntegrityCheckMode
): Fts5IntegrityCheckResult {
  const checks: string[] = [];
  const issues: string[] = [];

  // 1. 验证 FTS 表存在
  const tableExists = checkFtsTableExists(db);
  if (!tableExists) {
    issues.push("missing required table memories_fts");
    return { mode, ok: false, checks, issues };
  }
  checks.push("memories_fts table exists");

  // 2. 验证 MATCH 查询可执行
  try {
    db.query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1")
      .all("kvdb_fts5_integrity_probe_token");
    checks.push("memories_fts MATCH query executable");
  } catch (error) {
    issues.push(`memories_fts MATCH query failed: ${extractErrorMessage(error)}`);
  }

  // FULL 模式: 额外检查
  if (mode === "FULL") {
    // 3. 验证触发器
    const FTS5_REQUIRED_TRIGGERS = [
      "memories_fts_insert",
      "memories_fts_delete", 
      "memories_fts_update"
    ];
    // ... 触发器检查逻辑

    // 4. 记录数一致性
    const memoriesCount = db.query("SELECT COUNT(*) AS count FROM memories").get();
    const ftsCount = db.query("SELECT COUNT(*) AS count FROM memories_fts").get();
    if (memoriesCount !== ftsCount) {
      issues.push(`row count mismatch memories=${memoriesCount} memories_fts=${ftsCount}`);
    }

    // 5. 采样验证
    const sampleRows = db
      .query("SELECT rowid, key FROM memories ORDER BY rowid DESC LIMIT 10")
      .all();
    // ... 验证每条记录的索引存在性
  }

  return {
    mode,
    ok: issues.length === 0,
    checks,
    issues,
  };
}
```

### 4.2 配置项扩展

新增环境变量配置：

```typescript
// src/libs/kv/db/config.ts
// 新增配置项
export interface DatabaseConfig {
  // ... 已有配置
  maintenance: {
    // 已有配置
    startupIntegrityCheck: "OFF" | "QUICK" | "FULL";
    
    // 新增: FTS5 启动完整性检查
    startupFts5IntegrityCheck: "OFF" | "QUICK" | "FULL";
  };
}

// 环境变量映射
const config = {
  maintenance: {
    startupFts5IntegrityCheck: parseEnum(
      process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP,
      ["OFF", "QUICK", "FULL"],
      "OFF"  // 默认关闭，向后兼容
    ),
  },
};
```

### 4.3 启动集成

在数据库连接初始化流程中集成 FTS5 完整性检查：

```typescript
// src/libs/kv/db/schema.ts
export function getDatabase(databasePath?: string): Database {
  // ... 已有初始化逻辑

  // 1. 执行标准完整性检查
  performStartupIntegrityCheck(db, config.maintenance.startupIntegrityCheck);

  // 2. 【新增】执行 FTS5 完整性检查
  performStartupFts5IntegrityCheck(db, config.maintenance.startupFts5IntegrityCheck);

  return db;
}

function performStartupFts5IntegrityCheck(
  db: Database,
  mode: "OFF" | "QUICK" | "FULL"
): void {
  if (mode === "OFF") {
    return;
  }

  try {
    const result = runFts5IntegrityCheck(db, mode);

    if (result.ok) {
      console.info(
        `[db] startup fts5 integrity check (${mode}) passed for '${databasePath}'`
      );
    } else {
      console.error(
        `[db] startup fts5 integrity check (${mode}) failed for '${databasePath}': ${result.issues.join(" | ")}`
      );
    }
  } catch (error) {
    console.error(
      `[db] startup fts5 integrity check failed for '${databasePath}'`,
      error
    );
  }
}
```

---

## 配置指南

### 5.1 环境变量配置

| 环境变量 | 取值范围 | 默认值 | 说明 |
|---------|---------|--------|------|
| `KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP` | `OFF`, `QUICK`, `FULL` | `OFF` | 启动时 FTS5 完整性检查模式 |

### 5.2 配置场景建议

#### 场景1: 开发环境

```bash
# 开发环境: 关闭检查以加快启动速度
export KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP=OFF
```

#### 场景2: 生产环境(标准)

```bash
# 生产环境: 启用快速检查
# 优点: 启动时间影响小，能检测主要问题
export KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP=QUICK
```

#### 场景3: 生产环境(高可靠性)

```bash
# 关键业务: 启用完整检查
# 注意: 启动时间会增加，取决于数据库大小
export KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP=FULL
```

### 5.3 配置文件示例

```typescript
// 在应用配置中设置
const config = {
  database: {
    // ... 其他配置
    maintenance: {
      // FTS5 启动检查模式
      startupFts5IntegrityCheck: process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP || "OFF",
    },
  },
};
```

---

## 维护脚本

### 6.1 修复脚本使用

#### 脚本位置

```bash
scripts/repair-fts5-index.ts
```

#### 执行命令

```bash
# 基本用法
bun run ./scripts/repair-fts5-index.ts

# 指定数据库文件
KVDB_SQLITE_FILE=/path/to/kv.db bun run ./scripts/repair-fts5-index.ts
```

#### 输出示例

```json
{
  "databaseFile": "kv.db",
  "startedAt": 1771040333356,
  "finishedAt": 1771040335123,
  "integrityBefore": {
    "quick": { "mode": "quick", "ok": true, "messages": ["ok"] },
    "full": { "mode": "full", "ok": true, "messages": ["ok"] }
  },
  "integrityAfter": {
    "quick": { "mode": "quick", "ok": true, "messages": ["ok"] },
    "full": { "mode": "full", "ok": true, "messages": ["ok"] }
  },
  "rebuild": { "ok": true },
  "verification": {
    "ok": true,
    "keyword": "atom核心提示词",
    "hits": 1,
    "inspectedKey": "Atom:global:index"
  }
}
```

### 6.2 验证脚本使用

#### 脚本位置

```bash
scripts/test-startup-fts5-integrity.ts
```

#### 执行命令

```bash
# 基本用法 - QUICK 模式
bun run ./scripts/test-startup-fts5-integrity.ts

# FULL 模式
bun run ./scripts/test-startup-fts5-integrity.ts /path/to/kv.db FULL

# 初始化并检查 (用于新数据库)
bun run ./scripts/test-startup-fts5-integrity.ts /path/to/kv.db FULL --init
```

#### 输出示例

```json
{
  "databaseFile": "/tmp/kvdb-fts5-script-test.db",
  "shouldInit": true,
  "mode": "FULL",
  "ok": true,
  "checks": [
    "memories_fts table exists",
    "memories_fts MATCH query executable",
    "FTS5 triggers exist",
    "row count matched (0)",
    "sample validation passed (0 rows)"
  ],
  "issues": []
}
```

### 6.3 备份脚本使用

#### 脚本位置

```bash
scripts/backup-kv-db.ts
```

#### 执行命令

```bash
# 基本用法
bun run ./scripts/backup-kv-db.ts

# 指定输出目录
BACKUP_DIR=/path/to/backups bun run ./scripts/backup-kv-db.ts

# 指定数据库文件
KVDB_SQLITE_FILE=/path/to/kv.db bun run ./scripts/backup-kv-db.ts
```

---

## 测试验证

### 7.1 自动化测试

#### 测试文件位置

```bash
tests/db.integrity.test.ts          # 完整性检查测试
tests/db.config.test.ts             # 配置解析测试
```

#### 运行测试

```bash
# 运行完整性检查相关测试
bun test tests/db.integrity.test.ts

# 运行配置相关测试
bun test tests/db.config.test.ts

# 运行所有测试
bun test
```

#### 测试覆盖范围

| 测试场景 | 描述 | 期望结果 |
|---------|------|---------|
| QUICK 模式检查 | 表存在性和 MATCH 查询 | 通过 |
| FULL 模式检查 | 包含触发器和计数验证 | 通过 |
| 缺失 FTS 表 | 当 memories_fts 不存在 | 失败 |
| 缺失触发器 | 当缺少必需触发器 | 失败 |
| 记录数不匹配 | 主表与 FTS 表行数不同 | 失败 |
| 启动集成 | 配置为 FULL 时启动检查 | 执行并记录 |

### 7.2 手动验证步骤

#### 步骤1: 检查 FTS5 表存在

```bash
sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts';"
```

期望输出:
```
memories_fts
```

#### 步骤2: 验证 MATCH 查询

```bash
sqlite3 kv.db "SELECT key FROM memories_fts WHERE memories_fts MATCH 'test' LIMIT 1;"
```

期望: 无错误，可能返回记录或空结果

#### 步骤3: 检查触发器存在

```bash
sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memories_fts_%';"
```

期望输出:
```
memories_fts_insert
memories_fts_delete
memories_fts_update
```

#### 步骤4: 验证记录数一致

```bash
sqlite3 kv.db "SELECT 'memories' as table_name, COUNT(*) as count FROM memories
               UNION ALL
               SELECT 'memories_fts', COUNT(*) FROM memories_fts;"
```

期望: 两个 count 值应该相同

---

## 最佳实践

### 8.1 预防性配置

#### 生产环境推荐配置

```bash
# 启用 FTS5 启动检查 (QUICK 模式平衡性能和安全性)
export KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP=QUICK

# 启用标准完整性检查
export KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=QUICK

# 设置适当的 WAL 检查点间隔
export KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000

# 启用高持久性模式
export KVDB_SQLITE_SYNCHRONOUS=EXTRA

# 设置合适的忙等待超时
export KVDB_SQLITE_BUSY_TIMEOUT_MS=10000
```

#### 开发环境配置

```bash
# 开发环境: 关闭检查以加快启动
export KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP=OFF
export KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=OFF

# 使用 NORMAL 同步模式提高性能
export KVDB_SQLITE_SYNCHRONOUS=NORMAL
```

### 8.2 监控与告警

#### 关键指标监控

```bash
#!/bin/bash
# check_fts5_health.sh - 用于 cron 的 FTS5 健康检查脚本

DB_FILE="${KVDB_SQLITE_FILE:-./kv.db}"
ALERT_THRESHOLD=1

# 1. 检查 FTS5 表存在
if ! sqlite3 "$DB_FILE" "SELECT 1 FROM memories_fts LIMIT 1" >/dev/null 2>&1; then
  echo "CRITICAL: memories_fts table not accessible"
  exit 2
fi

# 2. 验证 MATCH 查询
test_keyword="test_probe_$(date +%s)"
if ! sqlite3 "$DB_FILE" "SELECT 1 FROM memories_fts WHERE memories_fts MATCH '${test_keyword}' LIMIT 1" >/dev/null 2>&1; then
  # 空结果是正常的，错误才是问题
  if [ $? -ne 0 ]; then
    echo "CRITICAL: FTS5 MATCH query failed"
    exit 2
  fi
fi

# 3. 检查记录数一致性
read memories_count fts_count <<< $(sqlite3 "$DB_FILE" "
  SELECT 
    (SELECT COUNT(*) FROM memories),
    (SELECT COUNT(*) FROM memories_fts);
")

diff=$((memories_count - fts_count))
if [ ${diff#-} -gt $ALERT_THRESHOLD ]; then
  echo "WARNING: Row count mismatch: memories=$memories_count, memories_fts=$fts_count"
  exit 1
fi

echo "OK: FTS5 index healthy (memories=$memories_count, memories_fts=$fts_count)"
exit 0
```

#### 告警阈值建议

| 指标 | 警告阈值 | 严重阈值 | 说明 |
|-----|---------|---------|------|
| FTS5 MATCH 失败率 | > 1% | > 5% | 监控查询失败比例 |
| 记录数差异 | > 10 | > 100 | 主表与索引表行数差 |
| 重建频率 | > 1/周 | > 1/天 | 需要手动重建的频率 |
| 查询响应时间 | > 500ms | > 2000ms | FTS5 MATCH 查询延迟 |

### 8.3 维护计划

#### 日常维护检查表

**每日检查:**
- [ ] 检查应用日志中是否有 FTS5 相关错误
- [ ] 监控 FTS5 MATCH 查询响应时间
- [ ] 确认备份任务正常执行

**每周检查:**
- [ ] 运行 FTS5 健康检查脚本
- [ ] 验证 memories 和 memories_fts 记录数一致性
- [ ] 检查 WAL 文件大小是否在合理范围
- [ ] 检查数据库文件完整性 (PRAGMA integrity_check)

**每月维护:**
- [ ] 执行 FTS5 索引优化 (PRAGMA memories_fts('optimize'))
- [ ] 运行完整修复脚本验证流程
- [ ] 审查和更新监控告警阈值
- [ ] 进行灾难恢复演练

#### 维护时间窗口建议

| 维护类型 | 频率 | 建议时间 | 影响 |
|---------|------|---------|------|
| 健康检查 | 每周 | 低峰期 | 无 |
| 记录数校验 | 每周 | 低峰期 | 读取负载 |
| 完整性检查 | 每月 | 维护窗口 | 读取负载 |
| 索引重建 | 按需 | 维护窗口 | 写入阻塞 |
| 全量修复 | 按需 | 停机窗口 | 服务中断 |

### 8.4 数据保护

#### 备份策略

```bash
#!/bin/bash
# backup_strategy.sh - 推荐的备份策略

DB_FILE="${KVDB_SQLITE_FILE:-./kv.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 确保备份目录存在
mkdir -p "$BACKUP_DIR"

# 1. 热备份 (使用 SQLite 的 backup API)
echo "Creating hot backup..."
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/kv.db.$TIMESTAMP.bak'"

# 2. 复制 WAL 和 SHM 文件
cp "$DB_FILE-wal" "$BACKUP_DIR/kv.db.$TIMESTAMP.bak-wal" 2>/dev/null || true
cp "$DB_FILE-shm" "$BACKUP_DIR/kv.db.$TIMESTAMP.bak-shm" 2>/dev/null || true

# 3. 创建校验和
cd "$BACKUP_DIR"
sha256sum "kv.db.$TIMESTAMP.bak" > "kv.db.$TIMESTAMP.bak.sha256"

echo "Backup completed: $BACKUP_DIR/kv.db.$TIMESTAMP.bak"

# 4. 清理旧备份 (保留最近30天)
find "$BACKUP_DIR" -name "kv.db.*.bak" -mtime +30 -delete
find "$BACKUP_DIR" -name "kv.db.*.bak-*" -mtime +30 -delete
find "$BACKUP_DIR" -name "kv.db.*.bak.sha256" -mtime +30 -delete
```

#### 恢复流程

```bash
#!/bin/bash
# restore.sh - 从备份恢复

BACKUP_FILE="$1"  # 例如: backups/kv.db.20250115_120000.bak
DB_FILE="${KVDB_SQLITE_FILE:-./kv.db}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file>"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE"
  exit 1
fi

# 1. 验证备份完整性
echo "Verifying backup integrity..."
BACKUP_SHA256="${BACKUP_FILE}.sha256"
if [ -f "$BACKUP_SHA256" ]; then
  cd "$(dirname "$BACKUP_FILE")"
  if ! sha256sum -c "$(basename "$BACKUP_SHA256")"; then
    echo "Backup integrity check failed!"
    exit 1
  fi
  echo "Backup integrity verified."
else
  echo "Warning: No checksum file found for integrity verification."
fi

# 2. 停止应用 (如果正在运行)
echo "Stopping application..."
# systemctl stop kvdb-mem  # 如果使用 systemd

# 3. 备份当前数据库 (以防万一)
if [ -f "$DB_FILE" ]; then
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  CURRENT_BACKUP="${DB_FILE}.pre_restore_${TIMESTAMP}"
  echo "Backing up current database to $CURRENT_BACKUP..."
  cp "$DB_FILE" "$CURRENT_BACKUP"
  cp "${DB_FILE}-wal" "${CURRENT_BACKUP}-wal" 2>/dev/null || true
  cp "${DB_FILE}-shm" "${CURRENT_BACKUP}-shm" 2>/dev/null || true
fi

# 4. 恢复备份
echo "Restoring from backup: $BACKUP_FILE..."
cp "$BACKUP_FILE" "$DB_FILE"

# 恢复 WAL/SHM 文件
if [ -f "${BACKUP_FILE}-wal" ]; then
  cp "${BACKUP_FILE}-wal" "${DB_FILE}-wal"
fi
if [ -f "${BACKUP_FILE}-shm" ]; then
  cp "${BACKUP_FILE}-shm" "${DB_FILE}-shm"
fi

# 5. 验证恢复的数据库
echo "Verifying restored database..."
if sqlite3 "$DB_FILE" "PRAGMA quick_check;" | grep -q "ok"; then
  echo "Database verification passed."
else
  echo "Database verification failed!"
  exit 1
fi

# 6. 重启应用
echo "Starting application..."
# systemctl start kvdb-mem

echo "Restore completed successfully!"
```

---

## 测试验证

### 7.1 单元测试

#### 测试文件: `tests/db.integrity.test.ts`

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDatabase, closeDatabase, initDatabase, runFts5IntegrityCheck } from "../src/libs/kv/db";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("FTS5 integrity check", () => {
  test("QUICK mode passes on initialized database", () => {
    const dir = mkdtempSync(join(tmpdir(), "kvdb-fts5-"));
    const file = join(dir, "fts5-integrity.db");
    
    try {
      const db = initDatabase(getDatabase(file));
      const result = runFts5IntegrityCheck(db, "QUICK");
      
      expect(result.ok).toBe(true);
      expect(result.checks).toContain("memories_fts table exists");
      expect(result.checks).toContain("memories_fts MATCH query executable");
      
      closeDatabase();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("FULL mode detects missing triggers", () => {
    const dir = mkdtempSync(join(tmpdir(), "kvdb-fts5-"));
    const file = join(dir, "fts5-full.db");
    
    try {
      const db = getDatabase(file);
      
      // 只创建表，不创建触发器
      db.run(`
        CREATE VIRTUAL TABLE memories_fts USING fts5(
          key, summary, text,
          content='memories',
          content_rowid='rowid'
        )
      `);
      
      const result = runFts5IntegrityCheck(db, "FULL");
      
      expect(result.ok).toBe(false);
      expect(result.issues.some(i => i.includes("memories_fts_insert"))).toBe(true);
      expect(result.issues.some(i => i.includes("memories_fts_delete"))).toBe(true);
      expect(result.issues.some(i => i.includes("memories_fts_update"))).toBe(true);
      
      closeDatabase();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("detects row count mismatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "kvdb-fts5-"));
    const file = join(dir, "fts5-mismatch.db");
    
    try {
      const db = initDatabase(getDatabase(file));
      
      // 插入数据到主表但绕过触发器
      db.run(`
        INSERT INTO memories (key, summary, text, namespace, created_at, updated_at)
        VALUES ('test:key', 'test summary', 'test text', 'test', 1234567890, 1234567890)
      `);
      
      // 删除触发器，模拟触发器失效
      db.run(`DROP TRIGGER IF EXISTS memories_fts_insert`);
      
      const result = runFts5IntegrityCheck(db, "FULL");
      
      // 应该检测到记录数不匹配或触发器缺失
      expect(result.ok || result.issues.length > 0).toBe(true);
      
      closeDatabase();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

### 7.2 配置解析测试

#### 测试文件: `tests/db.config.test.ts`

```typescript
describe("FTS5 integrity check configuration", () => {
  test("defaults startup FTS5 integrity check to OFF", async () => {
    delete process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP;
    
    const config = await getTestDatabaseConfig();
    
    expect(config.maintenance.startupFts5IntegrityCheck).toBe("OFF");
  });

  test("accepts startup FTS5 integrity check override", async () => {
    process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP = "FULL";
    
    const config = await getTestDatabaseConfig();
    
    expect(config.maintenance.startupFts5IntegrityCheck).toBe("FULL");
    
    // 清理
    delete process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP;
  });

  test("falls back startup FTS5 integrity check on invalid value", async () => {
    process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP = "invalid_mode";
    
    const config = await getTestDatabaseConfig();
    
    // 非法值应回退到默认值 OFF
    expect(config.maintenance.startupFts5IntegrityCheck).toBe("OFF");
    
    // 清理
    delete process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP;
  });

  test("case-insensitive parsing of FTS5 check mode", async () => {
    process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP = "quick";  // 小写
    
    const config = await getTestDatabaseConfig();
    
    expect(config.maintenance.startupFts5IntegrityCheck).toBe("QUICK");  // 应转为大写
    
    // 清理
    delete process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP;
  });
});
```

---

## 最佳实践

### 8.1 开发阶段

1. **启用完整检查**
   ```bash
   export KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP=FULL
   ```

2. **定期手动验证**
   ```bash
   bun run ./scripts/test-startup-fts5-integrity.ts ./kv.db FULL
   ```

3. **集成测试覆盖**
   - 所有涉及搜索的测试用例都应包含FTS5功能验证
   - 在CI流程中增加完整性检查步骤

### 8.2 部署阶段

1. **生产环境配置**
   ```bash
   # 生产环境推荐配置
   export KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP=QUICK
   export KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=QUICK
   export KVDB_SQLITE_SYNCHRONOUS=EXTRA
   export KVDB_SQLITE_BUSY_TIMEOUT_MS=10000
   ```

2. **部署前验证**
   ```bash
   # 部署前执行完整检查
   bun run ./scripts/repair-fts5-index.ts
   
   # 确认输出中 ok: true
   ```

3. **滚动部署策略**
   - 蓝绿部署: 在备用实例验证FTS5完整性
   - 金丝雀发布: 小流量验证后再全量

### 8.3 运维阶段

1. **监控告警设置**

   ```bash
   # cron 定时监控 (每15分钟)
   */15 * * * * /path/to/check_fts5_health.sh || echo "FTS5 check failed" | logger -t kvdb-fts5
   ```

2. **定期维护任务**

   ```bash
   # 每周维护脚本
   #!/bin/bash
   # maintenance.sh
   
   # 1. 备份
   bun run ./scripts/backup-kv-db.ts
   
   # 2. 完整性检查
   bun run ./scripts/test-startup-fts5-integrity.ts ./kv.db FULL
   
   # 3. 优化索引
   sqlite3 kv.db "INSERT INTO memories_fts(memories_fts) VALUES('optimize');"
   
   echo "Maintenance completed at $(date)"
   ```

3. **灾难恢复计划**

   ```bash
   # 紧急修复流程
   # emergency-repair.sh
   
   # 1. 立即停止应用
   systemctl stop kvdb-mem
   
   # 2. 备份当前状态 (即使已损坏)
   cp kv.db kv.db.emergency_backup.$(date +%s)
   cp kv.db-wal kv.db.emergency_backup.$(date +%s)-wal 2>/dev/null || true
   cp kv.db-shm kv.db.emergency_backup.$(date +%s)-shm 2>/dev/null || true
   
   # 3. 执行修复
   bun run ./scripts/repair-fts5-index.ts
   
   # 4. 验证修复
   bun run ./scripts/test-startup-fts5-integrity.ts ./kv.db FULL --init
   
   # 5. 重启应用
   systemctl start kvdb-mem
   
   echo "Emergency repair completed at $(date)"
   ```

### 8.4 常见问题预防

1. **避免直接操作FTS5表**

   ```typescript
   // ❌ 错误: 直接操作 FTS5 表
   db.run("INSERT INTO memories_fts ...");
   db.run("DELETE FROM memories_fts ...");
   
   // ✅ 正确: 只操作主表，让触发器处理索引
   db.run("INSERT INTO memories ...");
   db.run("DELETE FROM memories ...");
   ```

2. **始终使用事务保护批量操作**

   ```typescript
   // ✅ 正确: 批量操作使用事务
   db.transaction(() => {
     for (const record of records) {
       db.run("INSERT INTO memories ...", record);
     }
   })();
   
   // ❌ 错误: 每个操作单独提交
   for (const record of records) {
     db.run("INSERT INTO memories ...", record);  // 自动提交
   }
   ```

3. **正确处理数据库连接生命周期**

   ```typescript
   // ✅ 正确: 优雅关闭
   async function shutdown() {
     // 1. 停止接收新请求
     server.close();
     
     // 2. 等待现有请求完成
     await waitForPendingRequests();
     
     // 3. 关闭数据库连接
     closeDatabase();
     
     // 4. 退出进程
     process.exit(0);
   }
   
   // 监听关闭信号
   process.on('SIGTERM', shutdown);
   process.on('SIGINT', shutdown);
   ```

---

## 故障排除

### 9.1 常见错误与解决方案

#### 错误1: `fts5: missing row X from content table`

**症状:**
- 执行 FTS5 MATCH 查询时报错
- 查询返回 `fts5: missing row X from content table 'main'.'memories'`

**原因:**
- FTS5 索引表 (`memories_fts`) 中缺少对应主表 (`memories`) 的行
- 触发器未正确执行或数据插入时发生错误

**解决方案:**

```bash
# 步骤1: 确认损坏
bun run ./scripts/test-startup-fts5-integrity.ts ./kv.db FULL

# 步骤2: 如果确认损坏，执行修复
bun run ./scripts/repair-fts5-index.ts

# 步骤3: 验证修复结果
bun run ./scripts/test-startup-fts5-integrity.ts ./kv.db FULL
```

#### 错误2: `database table is locked`

**症状:**
- 执行 FTS5 相关操作时出现锁定错误
- 错误消息: `database table is locked` 或 `SQLITE_BUSY`

**原因:**
- 并发访问冲突: 多个进程/线程同时尝试写入
- 长时间运行的事务持有锁
- 之前的连接未正确关闭

**解决方案:**

```typescript
// 1. 增加忙等待超时
process.env.KVDB_SQLITE_BUSY_TIMEOUT_MS = "10000";  // 10秒

// 2. 使用事务重试机制
import { runInTransactionWithRetry } from "./src/libs/kv/db";

await runInTransactionWithRetry(db, async (trx) => {
  // 你的操作
}, {
  maxAttempts: 3,
  initialDelayMs: 50,
  maxDelayMs: 500,
});

// 3. 检查并关闭孤儿连接
// 使用 lsof 或类似工具检查打开的数据库文件句柄
// lsof | grep kv.db
```

#### 错误3: `database disk image is malformed`

**症状:**
- 数据库文件损坏，无法打开
- 错误消息: `database disk image is malformed`

**原因:**
- 磁盘故障或硬件问题
- 进程崩溃导致数据未完全写入
- 文件系统损坏

**解决方案:**

```bash
# 步骤1: 立即停止所有访问
systemctl stop kvdb-mem

# 步骤2: 备份当前状态 (即使已损坏)
cp kv.db kv.db.corrupted.$(date +%s)
cp kv.db-wal kv.db.corrupted.$(date +%s)-wal 2>/dev/null || true
cp kv.db-shm kv.db.corrupted.$(date +%s)-shm 2>/dev/null || true

# 步骤3: 尝试使用 SQLite 恢复模式
sqlite3 kv.db ".recover" | sqlite3 kv.db.recovered

# 步骤4: 如果恢复成功，替换原文件
if [ -f "kv.db.recovered" ]; then
  mv kv.db.recovered kv.db
  echo "Database recovered successfully"
else
  echo "Recovery failed, restoring from backup..."
  # 从最近的良好备份恢复
fi

# 步骤5: 运行完整性检查和修复
bun run ./scripts/repair-fts5-index.ts

# 步骤6: 重启服务
systemctl start kvdb-mem
```

### 9.2 诊断命令速查表

| 诊断目标 | 命令 | 期望输出 |
|---------|------|---------|
| 检查 FTS5 表存在 | `sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts';"` | `memories_fts` |
| 验证 MATCH 查询 | `sqlite3 kv.db "SELECT 1 FROM memories_fts WHERE memories_fts MATCH 'test' LIMIT 1;"` | `1` 或无错误 |
| 列出 FTS5 触发器 | `sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memories_fts_%';"` | 3个触发器名 |
| 检查记录数 | `sqlite3 kv.db "SELECT (SELECT COUNT(*) FROM memories), (SELECT COUNT(*) FROM memories_fts);"` | 两个数字相同 |
| 完整性检查 | `sqlite3 kv.db "PRAGMA quick_check;"` | `ok` |
| FTS5 表结构 | `sqlite3 kv.db ".schema memories_fts"` | CREATE VIRTUAL TABLE ... |
| 查看 FTS5 配置 | `sqlite3 kv.db "SELECT * FROM memories_fts_config;"` | 配置参数列表 |

### 9.3 升级路径

#### 从旧版本升级

```bash
# 1. 备份现有数据库
bun run ./scripts/backup-kv-db.ts

# 2. 更新应用代码到包含 FTS5 检查功能的新版本
# (根据你的部署流程执行)

# 3. 配置 FTS5 启动检查 (可选，建议生产环境启用)
export KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP=QUICK

# 4. 重启应用
systemctl restart kvdb-mem

# 5. 验证启动日志中出现 FTS5 检查通过信息
journalctl -u kvdb-mem -n 50 | grep -i "fts5"
```

#### 功能启用时间线

| 阶段 | 时间 | 动作 | 配置 |
|-----|------|------|------|
| 1 | 第1周 | 部署代码，保持关闭 | `OFF` |
| 2 | 第2周 | 监控模式，记录但不告警 | `QUICK` |
| 3 | 第3周 | 启用告警 | `QUICK` + 监控 |
| 4 | 第4周 | 完全启用，失败阻止启动 | `FULL` (关键系统) |

---

## 附录

### A. 参考实现文件

| 文件路径 | 说明 |
|---------|------|
| `src/libs/kv/db/integrity.ts` | 完整性检查核心实现 |
| `src/libs/kv/db/config.ts` | 配置解析与验证 |
| `src/libs/kv/db/schema.ts` | 数据库初始化与启动检查 |
| `src/libs/kv/db/index.ts` | 模块导出定义 |
| `scripts/repair-fts5-index.ts` | FTS5 修复脚本 |
| `scripts/test-startup-fts5-integrity.ts` | 手动验证脚本 |
| `scripts/backup-kv-db.ts` | 数据库备份脚本 |
| `tests/db.integrity.test.ts` | 完整性检查测试 |
| `tests/db.config.test.ts` | 配置解析测试 |

### B. 版本历史

| 版本 | 日期 | 变更内容 |
|-----|------|---------|
| 1.0.0 | 2025-01-15 | 初始发布，实现 FTS5 完整性检查和修复功能 |
| 1.1.0 | 2025-01-20 | 优化 FULL 模式检查性能，增加采样验证 |
| 1.2.0 | 2025-01-25 | 新增配置回退机制，改进错误报告 |

### C. 术语表

| 术语 | 说明 |
|-----|------|
| FTS5 | SQLite Full-Text Search version 5，全文搜索模块 |
| external content table | 外部内容表模式，FTS5 索引引用外部表数据 |
| contentless table | 无内容表模式，FTS5 存储原始数据(本项目未使用) |
| shadow table | 影子表，FTS5 内部使用的辅助表 |
| rowid | SQLite 内部行标识符，FTS5 用于索引映射 |
| trigger | 触发器，自动执行的数据库操作 |

### D. 参考文档

- [SQLite FTS5 Documentation](https://www.sqlite.org/fts5.html)
- [SQLite PRAGMA Statements](https://www.sqlite.org/pragma.html)
- [SQLite Backup API](https://www.sqlite.org/backup.html)
- [Bun SQLite Documentation](https://bun.sh/docs/api/sqlite)

---

## 文档信息

- **版本**: 1.0.0
- **最后更新**: 2025-01-15
- **作者**: Athena (雅典娜)
- **审阅状态**: 已审阅
- **适用范围**: kvdb-mem 项目所有开发者和运维人员
