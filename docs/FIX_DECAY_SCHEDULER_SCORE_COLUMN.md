# Decay Scheduler Score Column 缺失问题修复文档

## 文档信息

- **问题编号**: MEM-DECAY-047
- **修复日期**: 2026-02-14
- **影响版本**: 所有包含 Decay Scheduler 但未正确初始化 score 列的版本
- **修复优先级**: 高（阻塞 decay 调度器正常运行）

---

## 1. 问题概述

### 1.1 错误现象

Decay Scheduler 在运行时抛出以下错误：

```
SQLiteError: no such column: score
```

该错误发生在 `src/libs/decay/processor.ts:348` 的批处理查询中：

```typescript
const selectStatement = db.query(
  "SELECT key, summary, text, meta, score FROM memories ORDER BY key ASC LIMIT ? OFFSET ?",
);
```

### 1.2 影响范围

- **功能影响**: Decay Scheduler 完全无法运行，记忆评分机制失效
- **数据影响**: 无法计算和更新记忆分数，影响记忆生命周期管理
- **系统影响**: 可能导致记忆系统无法自动优化和清理

---

## 2. 根本原因分析

### 2.1 问题根源

1. **Schema 初始化不完整**: `initSchema()` 函数未调用 score 列相关的迁移函数
2. **迁移函数未被集成**: `migration.ts` 中提供的三个迁移助手函数未被 `schema.ts` 调用
3. **运行时依赖与初始化脱节**: decay 处理器运行时依赖 `memories.score` 列，但 schema 初始化未确保该列存在

### 2.2 代码路径分析

#### 问题路径：

```
src/libs/kv/db/schema.ts:initSchema()
  └─> ensureMemoriesTable()           [创建基本表结构]
  └─> ❌ 未调用 score 列迁移函数
      └─> decay scheduler 运行时查询 score 列失败
```

#### 期望路径：

```
src/libs/kv/db/schema.ts:initSchema()
  └─> ensureMemoriesTable()           [创建基本表结构]
  └─> addScoreColumnToMemories()      [添加 score 列]
  └─> createScoreIndexOnMemories()    [创建索引]
  └─> initializeExistingMemoryScores() [初始化现有数据]
      └─> decay scheduler 正常运行
```

### 2.3 技术债务分析

| 问题类型 | 描述 | 风险等级 |
|---------|------|---------|
| 初始化不完整 | Schema 初始化路径未覆盖所有必要的数据库结构 | 高 |
| 功能依赖未声明 | Decay scheduler 依赖 score 列，但初始化未强制执行 | 高 |
| 测试覆盖不足 | 缺乏集成测试确保 schema 初始化与功能运行的一致性 | 中 |

---

## 3. 修复实施

### 3.1 修复方案概述

采用**方案一：在 Schema 初始化中调用迁移函数**

- 在 `initSchema()` 函数中集成现有的迁移助手函数
- 保持迁移的幂等性和向后兼容性
- 确保调用顺序正确：添加列 → 创建索引 → 初始化数据

### 3.2 代码变更

#### 文件：src/libs/kv/db/schema.ts

**变更 1：添加导入**

```typescript
import {
  addScoreColumnToMemories,
  createScoreIndexOnMemories,
  initializeExistingMemoryScores,
} from "./migration";
```

**变更 2：在 initSchema 中调用迁移函数**

```typescript
export function initSchema(db: Database) {
  ensureMemoriesTable(db);
  addScoreColumnToMemories(db);           // 添加 score 列
  createScoreIndexOnMemories(db);          // 创建索引
  initializeExistingMemoryScores(db);      // 初始化现有数据
  ensureMemoryLinksTable(db);
  ensureKvCacheTable(db);
  // ... 其余索引和 FTS 对象创建
}
```

### 3.3 迁移函数说明

#### addScoreColumnToMemories

```typescript
export function addScoreColumnToMemories(db: Database): void
```

- **功能**: 向 `memories` 表添加 `score` 列
- **列定义**: `INTEGER DEFAULT 50 CHECK (score >= 0 AND score <= 100)`
- **幂等性**: 检查列是否存在，存在则跳过

#### createScoreIndexOnMemories

```typescript
export function createScoreIndexOnMemories(db: Database): void
```

- **功能**: 在 `memories(score)` 上创建索引 `idx_memories_score`
- **用途**: 支持基于分数的查询和排序
- **幂等性**: 使用 `CREATE INDEX IF NOT EXISTS`

#### initializeExistingMemoryScores

```typescript
export function initializeExistingMemoryScores(db: Database): void
```

- **功能**: 为所有 `score IS NULL` 的现有记忆设置 `score = 50`
- **用途**: 向后兼容，确保现有数据具有有效分数
- **幂等性**: 只更新 `NULL` 值的行

### 3.4 向后兼容性

修复方案完全向后兼容：

| 场景 | 行为 | 结果 |
|-----|------|------|
| 新数据库 | 创建表后立即添加 score 列 | score 列存在，所有功能正常 |
| 已修复的数据库 | 迁移函数检测到列已存在，跳过 | 无操作，性能影响极小 |
| 旧数据库（未修复） | 迁移函数添加列、索引，初始化数据 | 修复完成，功能恢复 |

---

## 4. 验证过程

### 4.1 测试策略

采用多层测试策略确保修复的正确性和完整性：

1. **单元测试**: 验证各个迁移函数的独立行为
2. **集成测试**: 验证 schema 初始化与 decay 调度的协同工作
3. **回归测试**: 确保修复不引入新的问题
4. **性能测试**: 验证迁移对启动时间的影响

### 4.2 测试执行结果

#### 4.2.1 迁移相关测试

```bash
$ bun test tests/decay.migration.test.ts
```

**结果**: 所有测试通过

| 测试用例 | 状态 | 描述 |
|---------|------|------|
| adds score column with expected constraints and default behavior | ✅ 通过 | 验证列添加、约束、默认值 |
| creates score index and keeps migration idempotent | ✅ 通过 | 验证索引创建和幂等性 |
| initializes only NULL scores and preserves existing score values | ✅ 通过 | 验证数据初始化逻辑 |
| handles migration failure and supports recovery after schema fix | ✅ 通过 | 验证错误恢复能力 |
| supports boundary case with empty memories table | ✅ 通过 | 验证空表边界情况 |

#### 4.2.2 Schema 初始化测试

```bash
$ bun test tests/db.schema.test.ts
```

**结果**: 所有测试通过

验证内容：
- `initSchema` 正确调用所有迁移函数
- 重复初始化不会报错（幂等性）
- 数据库结构符合预期

#### 4.2.3 Decay Scheduler 测试

```bash
$ bun test tests/decay.scheduler.test.ts
```

**结果**: 所有测试通过

验证内容：
- Scheduler 正确启动和停止
- Decay 任务按计划执行
- 分数计算和更新正常

#### 4.2.4 端到端测试

```bash
$ bun test tests/decay.e2e.test.ts
```

**结果**: 7 个测试全部通过

验证内容：
- 完整的 decay 生命周期
- 记忆分数随时间正确衰减
- 批量处理正确执行

### 4.3 数据库结构验证

#### 4.3.1 Schema 验证

```sql
-- 验证表结构
PRAGMA table_info(memories);
```

**预期输出**:

| cid | name | type | notnull | dflt_value | pk |
|-----|------|------|---------|------------|-----|
| 0 | key | TEXT | 1 | null | 1 |
| 1 | summary | TEXT | 1 | null | 0 |
| 2 | text | TEXT | 1 | null | 0 |
| 3 | meta | TEXT | 1 | null | 0 |
| 4 | created_at | INTEGER | 1 | null | 0 |
| 5 | score | INTEGER | 0 | 50 | 0 |

#### 4.3.2 约束验证

```sql
-- 验证检查约束
SELECT sql FROM sqlite_master 
WHERE type = 'table' AND name = 'memories';
```

**预期包含**: `CHECK (score >= 0 AND score <= 100)`

#### 4.3.3 索引验证

```sql
-- 验证索引
PRAGMA index_list(memories);
```

**预期输出**:

| seq | name | unique | origin | partial |
|-----|------|--------|--------|---------|
| ... | idx_memories_score | 0 | c | 0 |

### 4.4 性能验证

#### 4.4.1 启动时间测试

```bash
# 测试带迁移的启动时间
bun run -e "
const { initSchema } = require('./src/libs/kv/db/schema');
const { Database } = require('bun:sqlite');

const start = performance.now();
const db = new Database(':memory:');
initSchema(db);
const end = performance.now();

console.log(\`Schema initialization took \${(end - start).toFixed(2)}ms\`);
db.close();
"
```

**预期结果**: 初始化时间 < 100ms（内存数据库）

#### 4.4.2 迁移幂等性测试

```bash
# 重复运行迁移 100 次，验证幂等性
bun test tests/decay.migration.test.ts -t "idempotent"
```

**预期结果**: 重复执行不会报错，不会创建重复列或索引

---

## 5. 影响评估

### 5.1 对现有系统的影响

#### 5.1.1 数据库层面

| 影响项 | 描述 | 风险等级 |
|--------|------|---------|
| 表结构变更 | 添加 `score` 列到 `memories` 表 | 低（幂等操作） |
| 索引创建 | 新增 `idx_memories_score` 索引 | 低（IF NOT EXISTS） |
| 数据初始化 | 现有数据的 `score` 设为 50 | 低（仅 NULL 值） |
| 存储空间 | 每行增加 8 字节（INTEGER）+ 索引 | 极低 |

#### 5.1.2 应用层面

| 影响项 | 描述 | 风险等级 |
|--------|------|---------|
| 启动时间 | 迁移函数增加初始化时间（< 100ms） | 低 |
| 运行时性能 | score 列查询和更新增加少量开销 | 极低 |
| 功能可用性 | Decay Scheduler 从不可用变为可用 | 正面影响 |
| 向后兼容 | 完全兼容，不影响现有功能 | 无风险 |

### 5.2 风险评估

#### 5.2.1 已知风险

| 风险 | 概率 | 影响 | 缓解措施 |
|-----|------|------|---------|
| 迁移在大型数据库上执行缓慢 | 中 | 启动延迟 | 迁移设计为幂等，可分批执行；监控启动时间 |
| 并发启动导致竞争条件 | 低 | 索引创建冲突 | SQLite 事务机制保证原子性；IF NOT EXISTS 防止重复创建 |
| 现有数据被错误覆盖 | 极低 | 数据丢失 | 仅更新 `score IS NULL` 的行；现有值保持不变 |

#### 5.2.2 风险矩阵

```
影响
^ 高 |                     
|     |  [竞争条件]        
|  中 |  [大型库性能]       
|  低 |                     
|     +-------------------> 概率
|       低      中      高

[数据覆盖] - 极低概率，已规避
```

### 5.3 回滚方案

虽然此修复是安全的增量变更，但仍提供回滚方案：

#### 5.3.1 数据库级别回滚

```sql
-- 如果需要移除 score 列（警告：会丢失所有分数数据）
-- SQLite 不支持直接 DROP COLUMN，需要重建表

-- 1. 创建新表（无 score 列）
CREATE TABLE memories_backup (
  key TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  text TEXT NOT NULL,
  meta TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 2. 复制数据
INSERT INTO memories_backup SELECT key, summary, text, meta, created_at FROM memories;

-- 3. 删除旧表，重命名新表
DROP TABLE memories;
ALTER TABLE memories_backup RENAME TO memories;

-- 4. 重建索引和触发器（如果需要）
```

#### 5.3.2 应用级别回滚

```bash
# 1. 回滚代码到修复前版本
git revert <commit-hash>

# 2. 重建应用
bun run build

# 3. 重启服务
```

**注意**: 除非发现严重问题，否则不建议回滚。此修复是增量且安全的。

---

## 6. 最佳实践

### 6.1 预防类似问题的措施

#### 6.1.1 开发阶段

1. **强制性 Schema 验证**
   ```typescript
   // 在应用启动时验证必需的数据库结构
   export function validateDatabaseSchema(db: Database): void {
     const requiredColumns = ['key', 'summary', 'text', 'meta', 'created_at', 'score'];
     const columns = db.query("PRAGMA table_info(memories)").all() as {name: string}[];
     const columnNames = new Set(columns.map(c => c.name));
     
     for (const col of requiredColumns) {
       if (!columnNames.has(col)) {
         throw new Error(`Missing required column: ${col}`);
       }
     }
   }
   ```

2. **功能与 Schema 依赖声明**
   ```typescript
   // 在功能模块中明确声明数据库依赖
   export const DecaySchedulerDeps = {
     requiredColumns: ['score'],
     requiredIndexes: ['idx_memories_score'],
     minSchemaVersion: 2
   } as const;
   ```

3. **集成测试覆盖**
   ```typescript
   // 测试 Schema 初始化后功能正常工作
   describe('Schema + Feature Integration', () => {
     test('decay scheduler works after schema init', async () => {
       const db = new Database(':memory:');
       initSchema(db); // 初始化 schema
       
       // 验证 decay 可以正常运行
       await expect(runDecayCycle(db)).resolves.not.toThrow();
     });
   });
   ```

#### 6.1.2 代码审查阶段

1. **Schema 变更检查清单**
   - [ ] 新列/表是否有对应的迁移函数？
   - [ ] 迁移函数是否在 `initSchema` 中被调用？
   - [ ] 是否测试了幂等性（多次执行不报错）？
   - [ ] 是否向后兼容（现有数据不受影响）？

2. **依赖关系审查**
   ```
   当修改 schema.ts 时，必须检查：
   1. 所有依赖 memories 表的查询
   2. 所有直接查询 score 列的代码
   3. 所有假设特定 schema 结构的测试
   ```

#### 6.1.3 部署阶段

1. **数据库迁移验证脚本**
   ```bash
   #!/bin/bash
   # pre-deploy-check.sh
   
   echo "验证数据库迁移..."
   
   # 1. 备份现有数据库
   cp kv.db kv.db.backup.$(date +%Y%m%d_%H%M%S)
   
   # 2. 运行测试迁移
   bun run test:migration
   
   # 3. 验证 schema
   bun run verify:schema
   
   echo "预部署检查完成"
   ```

2. **蓝绿部署策略**
   ```
   1. 在绿色环境部署新版本
   2. 运行完整的 schema 验证
   3. 如果验证失败，保持蓝色环境运行
   4. 如果验证成功，切换流量到绿色环境
   ```

### 6.2 监控与告警

#### 6.2.1 运行时监控

```typescript
// 监控 decay scheduler 健康状态
export class DecaySchedulerMonitor {
  private lastSuccessRun: number = Date.now();
  private consecutiveFailures: number = 0;
  
  onSuccess() {
    this.lastSuccessRun = Date.now();
    this.consecutiveFailures = 0;
  }
  
  onError(error: Error) {
    this.consecutiveFailures++;
    
    // 如果连续失败 3 次，发送告警
    if (this.consecutiveFailures >= 3) {
      this.sendAlert('Decay scheduler failed 3 times in a row', error);
    }
    
    // 如果上次成功运行超过 1 小时，发送告警
    if (Date.now() - this.lastSuccessRun > 3600000) {
      this.sendAlert('Decay scheduler has not run successfully for 1 hour');
    }
  }
}
```

#### 6.2.2 关键指标

```yaml
# 推荐的监控指标
metrics:
  - name: decay_scheduler_run_duration_ms
    type: histogram
    description: Decay scheduler 单次运行耗时
    
  - name: decay_scheduler_memories_processed
    type: counter
    description: 处理的记忆数量
    
  - name: decay_scheduler_failures_total
    type: counter
    description: 失败次数
    labels: [error_type]
    
  - name: database_schema_version
    type: gauge
    description: 当前数据库 schema 版本
    
  - name: database_column_exists
    type: gauge
    description: 关键列是否存在
    labels: [table, column]
```

### 6.3 文档与培训

#### 6.3.1 开发者文档

1. **Schema 变更流程**
   ```markdown
   ## 如何添加新的数据库列
   
   1. 在 `migration.ts` 中添加迁移函数
   2. 在 `schema.ts:initSchema()` 中调用迁移函数
   3. 确保幂等性（多次运行不报错）
   4. 添加测试用例
   5. 更新开发者文档
   ```

2. **代码审查检查表**
   ```markdown
   ## Schema 相关代码审查检查表
   
   - [ ] 迁移函数是否幂等？
   - [ ] 是否在 `initSchema` 中被调用？
   - [ ] 是否有对应的测试？
   - [ ] 是否向后兼容？
   - [ ] 文档是否更新？
   ```

#### 6.3.2 运维文档

1. **部署检查表**
   ```markdown
   ## 部署前检查表
   
   - [ ] 数据库已备份
   - [ ] 迁移测试已通过
   - [ ] Schema 验证已通过
   - [ ] 回滚方案已准备
   - [ ] 监控已配置
   ```

2. **故障处理指南**
   ```markdown
   ## 常见故障处理
   
   ### 症状：decay scheduler 启动失败
   
   1. 检查数据库 schema:
      ```sql
      PRAGMA table_info(memories);
      ```
   
   2. 确认 score 列存在:
      ```sql
      SELECT name FROM pragma_table_info('memories') WHERE name = 'score';
      ```
   
   3. 如果列不存在，手动运行迁移:
      ```typescript
      import { addScoreColumnToMemories } from './migration';
      addScoreColumnToMemories(db);
      ```
   ```

---

## 7. 总结

### 7.1 修复成果

1. **问题已解决**: Decay Scheduler 可以正常运行，不再报 `no such column: score` 错误
2. **向后兼容**: 修复完全向后兼容，不影响现有数据
3. **幂等性保证**: 多次运行初始化不会报错
4. **测试覆盖**: 所有相关测试通过

### 7.2 经验总结

1. **Schema 初始化必须完整**: 所有数据库结构变更都必须在初始化路径中体现
2. **功能依赖必须显式声明**: 功能模块应明确声明其数据库依赖
3. **测试必须覆盖集成点**: 不仅要测试独立函数，还要测试初始化后的功能协同
4. **迁移必须幂等**: 所有迁移函数都应支持多次安全执行

### 7.3 后续建议

1. **引入 Schema 版本管理**: 考虑实现更正式的 schema 版本控制系统
2. **增强集成测试**: 添加更多场景测试，覆盖各种数据库初始状态
3. **完善监控**: 实施前文建议的监控指标和告警
4. **定期审查**: 建立定期的 schema 和迁移代码审查机制

---

## 附录

### A. 参考链接

- [SQLite ALTER TABLE 文档](https://www.sqlite.org/lang_altertable.html)
- [数据库迁移最佳实践](https://documentation.red-gate.com/flyway)
- [TypeScript SQLite 操作指南](https://bun.sh/docs/api/sqlite)

### B. 相关文件清单

| 文件路径 | 作用 | 变更状态 |
|---------|------|---------|
| `src/libs/kv/db/schema.ts` | Schema 初始化主文件 | 修改 |
| `src/libs/kv/db/migration.ts` | 迁移函数定义 | 参考 |
| `src/libs/decay/processor.ts` | Decay 批处理 | 参考 |
| `tests/decay.migration.test.ts` | 迁移测试 | 通过 |
| `tests/db.schema.test.ts` | Schema 测试 | 通过 |
| `tests/decay.scheduler.test.ts` | Scheduler 测试 | 通过 |
| `tests/decay.e2e.test.ts` | 端到端测试 | 通过 |

### C. 术语表

| 术语 | 定义 |
|-----|------|
| **Schema** | 数据库的结构定义，包括表、列、索引等 |
| **Migration** | 数据库结构的变更脚本，用于升级或降级 |
| **幂等性** | 操作多次执行与一次执行的效果相同 |
| **Decay** | 记忆分数随时间自然衰减的机制 |
| **FTS** | Full-Text Search，全文搜索引擎 |
| **WAL** | Write-Ahead Logging，SQLite 的一种日志模式 |

---

**文档结束**

*最后更新: 2026-02-14*
*维护者: Athena (雅典娜) - Project Structure & Documentation Architect*
