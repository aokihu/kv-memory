## Context

当前系统使用 Keyv + KeyvSqlite 适配器作为 SQLite 存储抽象层。所有记忆数据被序列化为 JSON 存储在单表的 `value` 列中，导致以下问题：
1. 无法进行字段级查询（如按 summary 搜索、按 domain 过滤）
2. Links 关系需要全量加载内存后遍历
3. Meta 统计无法通过数据库聚合计算
4. 每次读写都需要全量序列化/反序列化整个记忆对象

当前代码位于 `src/libs/kv/kv.ts`，实现了 `KVMemory` 类，通过 `Keyv` 接口与 SQLite 交互。需要重构为原生 SQLite 实现，同时保持 `KVMemory` 和 `KVMemoryService` 的 API 完全兼容。

## Goals / Non-Goals

**Goals:**
1. 将内存 Key-Value 存储替换为 SQLite 数据库存储
2. 设计合理的数据库表结构，将 meta、summary、text 分别存储在独立列中
3. 将 Link 关系单独存储在一张关联表中
4. 保持现有 API 接口完全不变
5. 提供数据迁移脚本，将现有数据从 Keyv 格式迁移到新格式
6. 提高查询性能，支持字段级检索和高效链接遍历

**Non-Goals:**
1. 不改变外部 API 接口和行为
2. 不添加新的功能特性
3. 不改变现有的记忆模型（MemorySchema）
4. 不引入新的外部依赖（仅使用 `bun:sqlite`，Bun 内置）

## Decisions

### Decision 1: 使用原生 `bun:sqlite` 替代 Keyv
- **Rationale**: Keyv 作为一个通用 KV 抽象，无法充分利用 SQLite 的关系查询能力。`bun:sqlite` 是 Bun 的内置模块，无需额外依赖，性能更好，API 更直接。
- **Alternatives considered**:
  - `better-sqlite3`: 性能优秀，但需要额外安装，增加依赖复杂性
  - `sqlite3`: Node.js 原生模块，但 API 相对底层
  - 保持 Keyv: 无法解决字段级查询和性能问题

### Decision 2: 单表多列设计而非分表设计
- **Rationale**: 需求明确要求"使用 Column 来单独的保存 meta, summary, text"，而不是分表存储。这符合关系数据库的规范化原则，也便于查询。
- **Schema design**:
  ```sql
  CREATE TABLE memories (
    key TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    domain TEXT NOT NULL,
    summary TEXT NOT NULL,
    text TEXT NOT NULL,
    type TEXT NOT NULL,
    keywords TEXT, -- JSON array
    meta TEXT,     -- JSON object
    links TEXT,    -- JSON array (redundant for quick access)
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  ```
- **Alternatives considered**:
  - 分表设计（memories, memory_meta, memory_content）：增加查询复杂度，不符合需求
  - 保持 JSON 存储：无法解决性能问题

### Decision 3: Links 冗余存储设计
- **Rationale**: 为了支持高效的双向遍历和查询，Links 将同时存储在：
  1. `memories.links` 列（JSON 数组，便于快速读取单个记忆的所有链接）
  2. `memory_links` 表（关系表，便于查询和遍历）
- **memory_links 表设计**:
  ```sql
  CREATE TABLE memory_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_key TEXT NOT NULL,
    to_key TEXT NOT NULL,
    link_type TEXT NOT NULL,
    weight REAL DEFAULT 0.5,
    FOREIGN KEY (from_key) REFERENCES memories(key),
    FOREIGN KEY (to_key) REFERENCES memories(key)
  );
  ```
- **Alternatives considered**:
  - 只存 JSON：无法高效查询和遍历
  - 只存关系表：读取单个记忆时需要额外查询

### Decision 4: 数据迁移策略
- **Rationale**: 需要将现有 Keyv SQLite 数据库中的数据迁移到新格式
- **Migration steps**:
  1. 读取 Keyv 数据库中的 `keyv` 表
  2. 解析每个记录的 `value` 列（JSON）
  3. 将解析后的数据按新 schema 插入到 `memories` 和 `memory_links` 表
  4. 验证数据完整性
- **Alternatives considered**:
  - 在线迁移：复杂度高，需要处理并发访问
  - 不迁移：无法使用现有数据，用户体验差

### Decision 5: 索引策略
- **Rationale**: 提高常见查询性能
- **Indexes to create**:
  ```sql
  CREATE INDEX idx_memories_namespace ON memories(namespace);
  CREATE INDEX idx_memories_domain ON memories(domain);
  CREATE INDEX idx_memories_created_at ON memories(created_at);
  CREATE INDEX idx_memory_links_from_key ON memory_links(from_key);
  CREATE INDEX idx_memory_links_to_key ON memory_links(to_key);
  CREATE INDEX idx_memory_links_type ON memory_links(link_type);
  ```
- **Alternatives considered**:
  - 不创建索引：查询性能差
  - 过多索引：增加写入开销和存储空间

## Risks / Trade-offs

### [Risk 1]: 数据迁移失败或数据丢失
- **Mitigation**: 
  - 迁移前备份原始数据库
  - 实现数据完整性验证
  - 提供回滚方案

### [Risk 2]: 并发访问冲突
- **Mitigation**:
  - 使用 SQLite 事务确保数据一致性
  - 实现适当的锁策略
  - 考虑使用 WAL（Write-Ahead Logging）模式

### [Risk 3]: 性能不如预期
- **Mitigation**:
  - 添加性能监控和基准测试
  - 优化查询语句和索引
  - 考虑缓存热点数据

### [Risk 4]: 兼容性问题
- **Mitigation**:
  - 确保 100% API 兼容性
  - 编写完整的测试用例
  - 进行回归测试

### Trade-off: 数据冗余 vs 查询性能
- **Decision**: 接受一定的数据冗余（Links 在 JSON 和关系表中同时存储）
- **Rationale**: 换取更好的查询性能和遍历效率

## Migration Plan

### Phase 1: 准备阶段
1. 备份现有 Keyv SQLite 数据库
2. 开发新的 SQLite 存储实现
3. 编写数据迁移脚本

### Phase 2: 测试阶段
1. 单元测试新实现
2. 集成测试数据迁移脚本
3. 性能基准测试

### Phase 3: 部署阶段
1. 安排停机时间
2. 执行数据迁移
3. 验证数据完整性
4. 部署新版本
5. 监控系统运行情况

### Phase 4: 回滚计划
1. 如果发现严重问题，恢复备份数据
2. 回退到旧版本

## Open Questions

1. **事务边界**: 是否需要支持跨多个记忆操作的事务？
   - **Current thinking**: 单个记忆的操作应该有事务保证，跨记忆的事务可能过于复杂

2. **连接池管理**: 如何处理多个 KVMemory 实例的数据库连接？
   - **Current thinking**: 使用单例数据库连接，所有实例共享

3. **缓存策略**: 是否需要添加内存缓存层？
   - **Current thinking**: 初始版本不添加，评估性能后再决定

4. **监控指标**: 需要收集哪些性能指标？
   - **Current thinking**: 查询延迟、内存使用、连接数等基本指标