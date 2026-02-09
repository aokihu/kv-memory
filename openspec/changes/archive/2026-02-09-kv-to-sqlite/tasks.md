## 1. 数据库 Schema 设计

- [x] 1.1 创建数据库 schema 定义文件 `src/libs/db/schema.ts`
- [x] 1.2 定义 `memories` 表结构（key, namespace, domain, summary, text, type, keywords, meta, links, created_at）
- [x] 1.3 定义 `memory_links` 表结构（id, from_key, to_key, link_type, weight）
- [x] 1.4 创建数据库初始化函数 `initDatabase()`
- [x] 1.5 创建表创建和索引创建的 SQL 语句
- [x] 1.6 添加必要的索引（namespace, domain, created_at, from_key, to_key, link_type）

## 2. SQLite 存储实现

- [x] 2.1 重构 `src/libs/kv/kv.ts` 中的 `KVMemory` 类
- [x] 2.2 移除 `keyv` 和 `@keyv/sqlite` 依赖
- [x] 2.3 实现基于 `bun:sqlite` 的数据库连接管理
- [x] 2.4 实现 `add()` 方法，将数据分别存储到不同列
- [x] 2.5 实现 `get()` 方法，从不同列读取并组装 Memory 对象
- [x] 2.6 实现 `update()` 方法，支持字段级更新
- [x] 2.7 实现 `updateKey()` 方法，更新主键
- [x] 2.8 实现 `setMeta()` 方法，更新 meta 字段
- [x] 2.9 实现 Links 的双向存储和同步（JSON + 关系表）
- [x] 2.10 实现事务支持，确保数据一致性

## 3. 数据迁移工具

- [x] 3.1 创建迁移脚本 `src/libs/db/migrate.ts`
- [x] 3.2 实现 Keyv 数据库备份功能
- [x] 3.3 实现 Keyv 数据解析（读取 `keyv` 表，解析 JSON value）
- [x] 3.4 实现数据转换逻辑（Keyv JSON → 新 schema 格式）
- [x] 3.5 实现数据插入到新表（memories, memory_links）
- [x] 3.6 实现数据完整性验证
- [x] 3.7 实现迁移脚本的幂等性（可重复运行）
- [x] 3.8 编写迁移文档和使用说明

## 4. 测试与验证

- [x] 4.1 编写单元测试，验证新存储实现的正确性
- [x] 4.2 编写集成测试，验证与现有服务的兼容性
  - [x] 4.3 创建性能基准测试，对比 Keyv 和新实现的性能
  - [x] 4.4 测试数据迁移脚本的完整流程
  - [x] 4.5 测试并发访问场景和事务处理
  - [x] 4.6 验证 100% API 向后兼容性

## 5. 依赖和配置更新

  - [x] 5.1 从 `package.json` 中移除 `keyv` 和 `@keyv/sqlite` 依赖
  - [x] 5.2 更新 TypeScript 类型定义（如有必要）
  - [x] 5.3 更新文档（AGENTS.md 等）中的存储实现说明
  - [x] 5.4 创建数据库配置选项（如数据库路径、WAL 模式等）

## 6. 部署准备

  - [x] 6.1 编写部署指南，包括迁移步骤
  - [x] 6.2 创建监控指标和日志记录
  - [x] 6.3 制定回滚计划文档
  - [x] 6.4 进行生产环境数据迁移的演练
  - [x] 6.5 验证所有现有功能在新实现下正常工作