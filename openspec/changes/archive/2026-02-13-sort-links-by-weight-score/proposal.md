## Why

记忆衰退算法已经实现了score字段（0-100范围）的计算，但当前返回的Links数组排序未能充分利用这个新信息。用户需要Links数组按照 `link weight × score` 进行从高到低排序，以反映记忆的"综合重要性"。这能更好地指导Agent在关联回忆时优先考虑更相关、更重要的记忆链接，提升记忆检索的质量和效率。

## What Changes

1. **修改记忆查询逻辑**：在返回记忆数据时，对其Links数组按照 `link weight × score` 进行从高到低排序
2. **扩展查询参数**：可选地添加排序参数，允许客户端控制是否启用此排序
3. **更新API文档**：反映新的排序行为
4. **添加测试**：验证排序算法的正确性和性能

**非破坏性变更**：此变更保持向后兼容性，现有客户端不受影响。

## Capabilities

### New Capabilities
- `link-score-sorting`: 提供基于link weight和memory score的综合排序算法，优化记忆关联检索的质量

### Modified Capabilities
- `memory-search`: 需要扩展搜索结果的排序逻辑，支持基于综合得分的链接排序
- `memory-api`: 需要更新API行为描述，说明Links数组的新排序规则

## Impact

**影响的代码**：
- `src/libs/kv/db/query.ts` - 需要修改查询逻辑，添加排序算法
- `src/service/searchService.ts` - 需要扩展搜索服务支持新的排序选项
- `src/mcp/tools/memoryGet.ts` - 需要更新MCP工具返回的Links排序
- `src/controller/getMemory.ts` - 需要更新HTTP API的响应格式

**影响的API**：
- `GET /memory/:key` - Links数组将按新规则排序
- `GET /search` 和 `GET /fulltext` - 搜索结果的Links将按新规则排序

**未来扩展**：
- MCP工具集成可在后续迭代中实现

**性能考虑**：
- 排序算法需要高效，避免影响查询性能
- 可能需要数据库索引优化
- 考虑批量查询时的排序效率

**测试影响**：
- 需要添加单元测试验证排序算法
- 需要集成测试验证端到端行为
- 需要性能测试确保无显著性能下降