## Why

根据用户要求，需要从Memory数据结构中删除domain和type字段，以简化Memory模型并减少不必要的字段冗余。这两个字段在当前系统中使用频率较低，且功能可以被其他字段替代，删除它们可以简化API接口、减少数据存储开销，并降低系统复杂度。

## What Changes

- **删除Memory数据结构中的domain字段** - 移除所有相关的类型定义、数据库列、API参数和验证逻辑
- **删除Memory数据结构中的type字段** - 移除所有相关的类型定义、数据库列、API参数和验证逻辑
- **更新数据库schema** - 从memories表中删除domain和type列，删除相关的索引
- **更新API接口** - 移除所有接受或返回domain和type字段的API端点
- **更新MCP工具** - 修改memoryAdd、memoryUpdate等MCP工具的参数定义
- **更新测试用例** - 更新所有相关的测试用例以反映字段删除
- **更新文档** - 更新AGENTS.md、MCP-README.md等相关文档

**BREAKING**：这是一个破坏性变更，将影响所有使用domain和type字段的客户端。

## Capabilities

### New Capabilities
- **memory-simplified-model**: 简化的Memory数据结构，移除domain和type字段，保持向后兼容的API适配层

### Modified Capabilities
- **kv-storage**: 修改数据库schema，删除domain和type列
- **memory-api**: 更新Memory相关的API接口，移除domain和type字段
- **mcp-integration**: 更新MCP工具的参数定义和验证逻辑

## Impact

**影响的代码范围：**
- 核心类型定义：src/type.ts
- 数据库层：src/libs/db/schema.ts, query.ts, migrate.ts, migration-utils.ts
- KV存储层：src/libs/kv/kv.ts
- 服务层：src/service/kvmemory.ts
- 控制器层：src/controller/*.ts
- MCP层：src/mcp/schemas/memory.ts, src/mcp/tools/*.ts, src/mcp/prompts/captureMemory.ts
- 测试文件：所有tests/*.test.ts文件
- 文档：AGENTS.md, MCP-README.md, docs/MEMORY_ALGORITHM.md

**API兼容性：**
- 破坏性变更，需要版本升级
- 现有客户端需要更新以适应新的API

**数据迁移：**
- 需要处理现有数据中的domain和type字段值
- 可能需要数据迁移脚本