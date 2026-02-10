## 1. 数据库Schema更新

- [x] 1.1 修改src/libs/db/schema.ts - 删除memories表中的domain和type列定义
- [x] 1.2 修改src/libs/db/schema.ts - 删除idx_memories_domain索引
- [x] 1.3 更新src/libs/db/query.ts - 修改MemoryRow类型定义，删除domain和type字段
- [x] 1.4 更新src/libs/db/query.ts - 修改memoryRowToMemory函数，移除domain和type映射
- [x] 1.5 更新src/libs/db/query.ts - 修改memoryToWritableColumns函数，移除domain和type字段
- [x] 1.6 更新src/libs/db/migrate.ts - 修改迁移SQL语句，删除domain和type列
- [x] 1.7 更新src/libs/db/migration-utils.ts - 修改相关工具函数

## 2. KV存储层更新

- [x] 2.1 修改src/libs/kv/kv.ts - 更新所有INSERT语句，移除domain和type列
- [x] 2.2 修改src/libs/kv/kv.ts - 更新所有UPDATE语句，移除domain和type列
- [x] 2.3 修改src/libs/kv/kv.ts - 更新所有SELECT语句，移除domain和type列
- [x] 2.4 修改src/libs/kv/kv.ts - 更新所有SQL参数绑定，移除domain和type参数
- [x] 2.5 修改src/libs/kv/kv.ts - 更新existsMemory函数的相关逻辑

## 3. MCP层更新

- [x] 3.1 修改src/mcp/schemas/memory.ts - 更新MemoryValueSchema，移除domain和type字段
- [x] 3.2 修改src/mcp/tools/memoryAdd.ts - 更新参数定义，移除domain和type
- [x] 3.3 修改src/mcp/tools/memoryUpdate.ts - 更新参数定义，移除domain和type
- [x] 3.4 修改src/mcp/tools/memoryGet.ts - 更新响应格式，移除domain和type
- [x] 3.5 修改src/mcp/prompts/captureMemory.ts - 更新参数定义，移除domain和type

## 4. 服务层更新

- [x] 4.1 修改src/service/kvmemory.ts - 更新接口定义，移除domain和type字段
- [x] 4.2 修改src/controller/addMemory.ts - 更新请求验证，拒绝domain和type字段
- [x] 4.3 修改src/controller/updateMemory.ts - 更新请求验证，拒绝domain和type字段
- [x] 4.4 修改src/controller/getMemory.ts - 更新响应格式，移除domain和type字段

## 5. 数据迁移准备

- [x] 5.1 创建数据迁移脚本 - 处理现有数据中的domain和type值
- [x] 5.2 设计数据迁移策略 - 确定如何处理现有数据
- [x] 5.3 创建数据备份脚本 - 在迁移前备份数据库

## 6. 测试更新

- [x] 6.1 更新tests/kv.sqlite.test.ts - 移除所有domain和type相关的测试用例
- [x] 6.2 更新tests/all.test.ts - 更新集成测试
- [x] 6.3 更新tests/final-verification.test.ts - 验证字段删除后的功能
- [x] 6.4 更新tests/concurrent-access.test.ts - 更新并发测试
- [x] 6.5 更新tests/api-compatibility.test.ts - 测试API兼容性
- [x] 6.6 更新benchmarks/*.ts - 更新性能测试

## 7. 文档更新

- [x] 7.1 更新AGENTS.md - 删除domain和type字段的描述
- [x] 7.2 更新MCP-README.md - 更新所有示例代码
- [x] 7.3 更新docs/MEMORY_ALGORITHM.md - 更新相关描述
- [x] 7.4 创建迁移指南文档 - 帮助用户更新客户端

## 8. 验证和清理

- [x] 8.1 运行完整测试套件 - 确保所有测试通过 (32 pass / 0 fail)
- [x] 8.2 验证编译无错误 - 确保类型系统正确
- [x] 8.3 清理临时文件 - 删除不再需要的文件
- [x] 8.4 更新版本信息 - 标记破坏性变更