## Why

当前系统使用 Keyv 内存存储实现 Key-Value 记忆系统（基于 `@keyv/sqlite`）。这种设计将所有记忆数据作为序列化 JSON 存储在单表的 `value` 列中，导致无法针对特定字段（如 `meta` 的访问统计、`summary`、`text` 内容）进行高效查询和更新。随着数据量增长，每次读取和写入都需要全量序列化/反序列化整个记忆对象，性能瓶颈日益明显。需要将存储层从 Keyv 简单键值存储迁移到原生 SQLite 关系模型，以支持字段级查询、增量更新和 Links 关系的高效管理。

## What Changes

- **存储层重构**：移除 `keyv` 和 `@keyv/sqlite` 依赖，使用原生 `bun:sqlite` 实现数据持久化
- **数据库 Schema 设计（单表多列）**：
  - `memories` 表：使用独立列存储不同数据字段
    - `key` (TEXT PRIMARY KEY): 记忆唯一标识
    - `namespace` (TEXT): 命名空间
    - `domain` (TEXT): 领域
    - `summary` (TEXT): 摘要
    - `text` (TEXT): 完整内容
    - `type` (TEXT): 类型
    - `keywords` (TEXT): 关键词（JSON 数组）
    - `meta` (TEXT): 元数据（JSON，包含 created_at, access_count, status 等）
    - `links` (TEXT): Links 关系（JSON 数组，包含 type, key, term, weight）
  - `memory_links` 表：存储 Links 关系（冗余设计，用于高效查询）
    - `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
    - `from_key` (TEXT): 源记忆 key
    - `to_key` (TEXT): 目标记忆 key
    - `link_type` (TEXT): 关系类型
    - `weight` (REAL): 权重
- **API 完全兼容**：`KVMemory` 和 `KVMemoryService` 保持现有接口不变
- **数据迁移**：提供从 Keyv SQLite 到原生 Schema 的一次性迁移脚本

## Capabilities

### New Capabilities

*无新 Spec-level 能力引入。本次变更仅为基础设施实现层重构，不涉及功能需求变更。*

### Modified Capabilities

*无 Spec-level 需求变更。现有 Memory 存储和检索行为的业务逻辑保持不变，仅底层存储实现从 Keyv 适配器改为原生 SQLite。*

## Impact

- **代码层面**：
  - `src/libs/kv/kv.ts`：完全重构，`KVMemory` 类内部实现改为 SQLite 操作
  - `src/libs/kv/`：新增 SQLite 工具函数和查询构建器
  - `src/libs/db/schema.ts`：定义数据库表结构和迁移逻辑
  - `src/libs/db/migrate.ts`：Keyv 到原生 SQLite 的数据迁移脚本
  - `src/service/kvmemory.ts`：无需修改，依赖接口保持不变

- **依赖层面**：
  - 移除：`keyv`, `@keyv/sqlite`
  - 新增：使用 `bun:sqlite`（Bun 内置，无需额外安装）

- **API 层面**：
  - 保持 100% 向后兼容，所有现有调用无需修改

- **数据层面**：
  - 提供一次性迁移脚本，将现有 Keyv SQLite 数据库迁移到新 Schema
  - 迁移期间需要短暂停机（离线迁移）
