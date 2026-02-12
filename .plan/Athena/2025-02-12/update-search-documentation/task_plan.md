# Task Plan: 更新搜索功能文档

## Task ID
TASK-005-UPDATE-DOCUMENTATION

## 任务目标
更新搜索功能相关文档，添加session支持和namespace过滤的说明。

## 背景信息
搜索功能已实现session支持和namespace过滤（任务1-4已完成），需要更新文档以反映这些新特性。

## 需要更新的文档

1. **API.md**
   - 更新 `/search` 和 `/fulltext` 端点的参数说明，添加 `session` 字段
   - 添加 session 验证错误代码说明
   - 提供带 session 的 curl 示例

2. **MCP-README.md**
   - 更新 `memory_search` 和 `memory_fulltext_search` 工具说明，添加 `session` 参数
   - 说明 session 验证和 namespace 过滤
   - 提供带 session 的 MCP 工具使用示例

3. **SEARCH-GUIDE.md**
   - 添加 "Namespace过滤" 章节
   - 说明 session 与 namespace 的关系
   - 提供 namespace 过滤的使用场景和示例

## 关键实现细节

### Session 验证
- session 参数为可选
- 有效 session 返回对应的 namespace
- 无效 session 返回 401 错误

### Namespace 过滤
- 有效 session 只返回对应 namespace 的记忆（key 以 `{namespace}:` 开头）
- 无 session 时执行全局搜索
- namespace 从 session 的 `kv_namespace` 字段获取

### 向后兼容
- 无 session 参数时保持全局搜索行为
- 现有代码无需修改

## 检查清单

- [x] 阅读现有文档
- [x] 分析代码实现
- [x] 更新 API.md
- [x] 更新 MCP-README.md
- [x] 更新 SEARCH-GUIDE.md
- [ ] 验证文档一致性
