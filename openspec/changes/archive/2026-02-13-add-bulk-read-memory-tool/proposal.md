## Why

The bulk memory reading functionality was previously implemented as an extension to the existing `memory_get` MCP tool through the `add-bulk-memory-read` change. However, this creates inconsistency in the tool architecture and naming conventions. Users specifically requested a standalone `bulk_read_memory` tool (snake_case naming) that is separate from the existing `memory_get` tool. This change addresses the architectural inconsistency and provides a clean, dedicated interface for bulk memory operations.

## What Changes

- **新增独立工具**：创建新的MCP工具 `bulk_read_memory`（snake_case命名）
- **移除不一致性**：将现有的批量读取功能从`memory_get`工具中分离出来
- **保持向后兼容**：现有的`memory_get`工具继续工作，但不再包含批量读取功能
- **更新文档**：更新MCP-README.md和其他文档以反映新的独立工具
- **重构实现**：将现有的批量读取算法从`memory_get`工具中提取到新的独立工具中

## Capabilities

### New Capabilities
- `bulk-read-memory-tool`: 独立的批量读取内存工具，支持深度优先遍历、权重排序、去重和限制控制

### Modified Capabilities
- `memory-mcp`: 现有的MCP工具规范需要更新，移除`memory_get`工具中的批量读取功能

## Impact

- **代码影响**：
  - 需要创建新的MCP工具文件：`src/mcp/tools/bulkReadMemory.ts`
  - 需要更新`src/mcp/server.ts`来注册新工具
  - 需要更新`src/mcp/schemas/memory.ts`来添加新工具的模式定义
  - 需要从`src/mcp/tools/memoryGet.ts`中移除批量读取相关代码
  
- **文档影响**：
  - 更新`MCP-README.md`：移除`memory_get`中的批量读取说明，添加`bulk_read_memory`工具说明
  - 更新`API.md`：可能需要更新相关说明
  - 更新`docs/BULK_READ_GUIDE.md`：更新工具使用示例
  
- **测试影响**：
  - 需要创建新的测试文件：`tests/mcp.bulk-read-tools.test.ts`
  - 需要更新现有测试：`tests/mcp.search-tools.test.ts`移除批量读取相关测试
  - 需要确保所有23个现有测试继续通过
  
- **向后兼容性**：
  - 现有的`memory_get`工具API保持不变（只是移除批量读取功能）
  - 现有的HTTP API端点`GET /api/memories/{key}/bulk`保持不变
  - 现有的批量读取核心算法`src/service/kvmemory.ts`中的`bulkReadMemory`方法保持不变