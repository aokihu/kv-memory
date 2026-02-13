## Why

现有的MCP工具（memory_get, memory_search, memory_fulltext_search）返回的记忆链接（links）数组未按重要性排序，这影响了Agent在关联回忆时的决策质量。虽然HTTP API已经实现了按 `link weight × score` 排序的功能，但MCP工具尚未集成这一能力，导致通过MCP协议访问的记忆数据缺乏优化排序。

## What Changes

- **新增 `sortLinks` 参数**：为MCP工具添加可选的 `sortLinks` 参数，控制返回的links数组是否排序
- **默认启用排序**：保持与HTTP API一致的行为，默认启用链接排序
- **向后兼容**：不破坏现有MCP工具调用，未指定参数时使用默认排序行为
- **参数验证**：支持boolean值（true/false）和字符串值（"true"/"false"）
- **排序算法**：使用与HTTP API相同的 `link weight × memory score` 综合得分算法

## Capabilities

### New Capabilities
- `mcp-link-sorting`: 为MCP工具添加链接排序能力，支持通过参数控制返回的links数组排序

### Modified Capabilities
- `mcp-integration`: 扩展MCP工具参数支持，添加 `sortLinks` 参数到相关工具
- `mcp-search-tools`: 更新搜索工具的links排序行为，确保搜索结果中的links也正确排序
- `memory-api`: 确保MCP工具与HTTP API在links排序行为上保持一致

## Impact

**受影响的代码：**
- `src/mcp/tools/memoryGet.ts` - 需要添加 `sortLinks` 参数处理
- `src/mcp/tools/memorySearch.ts` - 需要添加 `sortLinks` 参数处理  
- `src/mcp/tools/memoryFulltextSearch.ts` - 需要添加 `sortLinks` 参数处理
- `src/mcp/schemas/search.ts` - 需要更新schema定义
- `src/mcp/schemas/memory.ts` - 可能需要更新相关schema

**API影响：**
- MCP工具调用现在支持可选的 `sortLinks` 参数
- 默认行为改变：未指定参数时links会自动排序
- 保持与现有HTTP API的兼容性和一致性

**依赖关系：**
- 依赖已实现的 `sortLinksByCombinedScore` 排序算法
- 依赖现有的记忆score计算和link weight存储
- 需要确保MCP工具与HTTP API使用相同的排序逻辑