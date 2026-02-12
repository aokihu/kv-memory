## Why

当前kvdb-mem系统缺乏记忆搜索功能，当记忆数量增长时，仅靠key的层级结构难以快速定位特定记忆。根据NEXT-STEP.md文档的分析，搜索功能是P0优先级的需求，是当前最大的痛点。同时，现有的MCP工具集缺少搜索相关工具，限制了Agent对记忆系统的有效利用。

## What Changes

1. **实现全文检索功能**：基于SQLite FTS5扩展实现记忆内容的全文搜索
2. **新增搜索API端点**：
   - `GET /search`：支持关键词搜索、分页、相关性排序
   - `GET /fulltext`：支持多关键词组合搜索
3. **新增MCP搜索工具**：
   - `memory_search`：提供记忆搜索功能的MCP工具
   - `memory_fulltext_search`：提供全文搜索功能的MCP工具
4. **增强现有系统**：在现有记忆存储基础上添加全文索引，保持向后兼容

## Capabilities

### New Capabilities
- **memory-search**: 提供记忆搜索功能，包括关键词搜索、相关性排序、分页过滤
- **mcp-search-tools**: 提供MCP搜索工具，使Agent能够通过MCP协议搜索记忆

### Modified Capabilities
- **memory-storage**: 需要扩展以支持FTS5全文索引
- **mcp-integration**: 需要添加新的搜索工具到MCP工具集

## Impact

1. **数据库层**：需要创建FTS5全文索引表，修改数据库schema
2. **服务层**：需要新增搜索服务模块
3. **API层**：需要新增搜索相关API端点
4. **MCP层**：需要新增搜索相关MCP工具
5. **测试**：需要添加搜索功能的单元测试和集成测试
6. **文档**：需要更新API文档和MCP工具文档