# Changelog

## [Unreleased] - 批量读取记忆功能改进

### Added

#### 独立的批量读取MCP工具
- **新增独立工具**：`bulk_read_memory`（snake_case命名）
- **工具分离**：将批量读取功能从`memory_get`工具中分离出来
- **参数一致性**：使用`total`参数名（与HTTP API保持一致），而非`totalLimit`
- **完整测试**：新增`tests/mcp.bulk-read-tools.test.ts`测试文件

### Changed

#### MCP工具架构优化
- **`memory_get`工具简化**：移除批量读取功能，专注于单内存读取
- **工具注册更新**：在MCP服务器中注册独立的`bulk_read_memory`工具
- **参数模式更新**：更新`MemoryGetSchema`，移除批量读取相关参数
- **文档更新**：更新所有文档以反映新的工具架构

#### 文档改进
- **MCP-README.md**：添加`bulk_read_memory`工具完整说明，明确与`memory_get`的区别
- **BULK_READ_GUIDE.md**：更新所有工具引用为`bulk_read_memory`，统一参数命名
- **API.md**：澄清HTTP API保持不变，MCP工具作为补充接口

### Removed

- **从`memory_get`移除**：`bulkRead`、`depth`、`breadth`、`total`参数
- **从测试中移除**：`memory_get`中的批量读取相关测试用例

### Technical Details

- **向后兼容性**：HTTP API端点`GET /api/memories/{key}/bulk`保持不变
- **核心算法**：继续使用现有的深度优先遍历算法
- **默认参数**：depth=3, breadth=5, total=20
- **最大限制**：depth=6, breadth=20, total=50
- **工具命名**：统一使用snake_case命名规范

---

## 批量读取记忆功能（初始实现）

### Added

#### 批量读取记忆功能

- **HTTP API 支持**:
  - 新增 `GET /api/memories/{key}/bulk` 端点
  - 支持 `depth` (1-6)、`breadth` (1-20)、`total` (1-50) 参数配置
  - 返回结构化响应，包含目标记忆、关联记忆数组和遍历元数据
  - 完整的参数验证和错误处理

- **MCP 工具扩展**:
  - 新增 `memory_bulk_read` 工具
  - 支持完整的参数配置：depth、breadth、totalLimit
  - 兼容 JSON 和 TOON 输出格式
  - 支持 Session namespace 过滤

- **核心算法**:
  - 深度优先遍历（DFS）算法实现
  - 基于 `link_weight × memory_score` 的智能排序
  - 基于 memory key 的去重机制
  - 三层限制保护（深度、广度、总量）
  - 达到任一限制立即停止遍历

- **文档支持**:
  - 用户指南：`docs/BULK_READ_GUIDE.md`
  - API 文档更新：`API.md`
  - MCP 工具文档更新：`MCP-README.md`
  - 完整的使用示例和故障排除指南

### Changed

- 更新了 `API.md`，添加批量读取端点详细说明
- 更新了 `MCP-README.md`，添加 `memory_bulk_read` 工具说明
- 更新了 `CHANGELOG.md`，记录批量读取功能变更

### Technical Details

- **默认参数**：depth=3, breadth=5, total/totalLimit=20
- **最大限制**：depth=6, breadth=20, total/totalLimit=50
- **排序算法**：按 `link_weight × memory_score` 降序
- **去重策略**：基于 memory key 的 Set 去重
- **停止条件**：任一限制达到或遍历完成

---

## 1.0.0 - 2026-02-10

### BREAKING CHANGES

- Removed `domain` and `type` fields from memory write/update API payloads.
- Clients still sending `domain` or `type` will now fail input validation.

### Notes

- This release marks a breaking API contract change and requires client-side payload updates.
