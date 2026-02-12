## Context

当前kvdb-mem系统使用SQLite作为记忆存储后端，提供了基本的CRUD操作和记忆链接功能。系统包含HTTP API和MCP工具集，但缺乏搜索功能。根据NEXT-STEP.md文档的分析，搜索功能是P0优先级的需求，当记忆数量增长时，仅靠key的层级结构难以快速定位特定记忆。

现有架构包括：
- 数据库层：基于`bun:sqlite`，使用memories和memory_links表
- 服务层：KVMemoryService处理业务逻辑
- API层：REST API端点（/add_memory, /get_memory等）
- MCP层：基于fastmcp的MCP服务器，提供记忆操作工具

## Goals / Non-Goals

**Goals:**
1. 实现基于SQLite FTS5的全文搜索功能
2. 提供REST API搜索端点（/search, /fulltext）
3. 提供MCP搜索工具（memory_search, memory_fulltext_search）
4. 保持向后兼容性，不破坏现有API
5. 支持关键词高亮和相关性排序
6. 实现分页和过滤功能

**Non-Goals:**
1. 可视化搜索界面（纯后端实现）
2. 高级自然语言处理（使用SQLite FTS5基础功能）
3. 实时搜索建议/自动完成
4. 搜索历史记录保存
5. 复杂的搜索语法（支持基础AND/OR操作）

## Decisions

### 1. 搜索技术选型：SQLite FTS5
**选择原因：**
- 无需外部依赖，与现有SQLite存储集成
- 轻量级，适合嵌入式使用场景
- 支持中文分词（通过ICU分词器）
- 提供相关性排序（bm25算法）
- 支持前缀搜索和模糊匹配

**替代方案考虑：**
- Elasticsearch：功能强大但重量级，需要单独部署
- SQLite VSS：向量搜索，更适合语义搜索而非关键词搜索
- 自定义倒排索引：开发成本高，维护复杂

### 2. 数据库架构设计
**FTS5虚拟表设计：**
- 表名：`memories_fts`
- 列：key（文档ID），summary，text
- 分词器：`unicode61`（支持Unicode字符，包括中文）
- 内容同步：使用外部内容表（memories）和触发器自动同步

**索引维护策略：**
- 创建触发器自动同步memories表到memories_fts表
- 支持增量更新，避免全表重建
- 定期优化命令维护索引性能

### 3. API设计
**搜索端点：**
- `GET /search?q={query}&limit={limit}&offset={offset}`
- `GET /fulltext?keywords={comma-separated}&operator={AND|OR}&limit={limit}&offset={offset}`

**响应格式：**
```json
{
  "results": [
    {
      "key": "Zeus:global:profile:core",
      "summary": "Zeus核心身份设定",
      "excerpt": "...<mark>quantum</mark>...",
      "relevance": 0.85,
      "score": 0.85
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 10,
    "offset": 0
  }
}
```

### 4. MCP工具设计
**工具定义：**
- `memory_search`：基础关键词搜索
- `memory_fulltext_search`：全文搜索，支持多关键词组合

**参数设计：**
- 与REST API参数保持一致
- 使用JSON schema验证参数
- 提供清晰的错误消息

### 5. 代码架构
**新模块：**
- `src/service/searchService.ts`：搜索业务逻辑
- `src/controller/searchController.ts`：搜索API控制器
- `src/mcp/tools/memorySearch.ts`：MCP搜索工具
- `src/mcp/tools/memoryFulltextSearch.ts`：MCP全文搜索工具

**集成点：**
- 数据库迁移：添加FTS5表创建脚本
- MCP服务器：注册新工具
- API路由：添加搜索路由

## Risks / Trade-offs

### 风险1：中文分词准确性
- **风险**：SQLite FTS5默认分词器对中文支持有限
- **缓解**：使用`unicode61`分词器，考虑添加简单的中文分词预处理

### 风险2：性能影响
- **风险**：FTS5索引增加存储空间和写入开销
- **缓解**：使用外部内容表减少存储冗余，定期优化索引

### 风险3：向后兼容性
- **风险**：新增API可能影响现有客户端
- **缓解**：保持现有API不变，新增端点使用新路径

### 风险4：配置复杂性
- **风险**：FTS5需要特定编译选项支持
- **缓解**：提供清晰的安装和配置文档，添加功能检测

### 权衡：功能完整性 vs 开发成本
- 选择基础FTS5功能而非高级搜索特性
- 优先实现核心搜索需求，后续可扩展

## Migration Plan

### 阶段1：开发与测试
1. 实现数据库迁移脚本（添加FTS5表）
2. 实现搜索服务模块
3. 实现API端点
4. 实现MCP工具
5. 编写单元测试和集成测试

### 阶段2：部署
1. 运行数据库迁移（非破坏性，可回滚）
2. 部署新版本服务
3. 验证搜索功能
4. 更新文档

### 阶段3：监控与优化
1. 监控搜索性能
2. 收集使用反馈
3. 优化索引策略

### 回滚策略：
- 数据库：删除FTS5表（数据保留在memories表）
- 代码：回退到前一版本
- API：新增端点，不影响现有功能

## Open Questions

1. **中文分词优化**：是否需要添加中文分词预处理层？
2. **搜索结果缓存**：是否实现搜索结果缓存以提高性能？
3. **搜索权限**：是否需要对搜索进行权限控制？
4. **索引重建策略**：如何处理大规模数据迁移时的索引重建？