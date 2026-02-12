# Findings

## TASK-007-UPDATE-MCP-TESTS
- `memory_search` 与 `memory_fulltext_search` 的多个测试未传 `session`，会与“session 必填”冲突。
- 明确需要删除/改造用例：`memory_search without session keeps global search behavior`。
- 参数校验测试当前用例也缺 `session`，需要补充有效 `session` 以确保仅校验目标字段。
- `toon` 输出测试的两个工具调用都缺 `session`，需要为每个调用提供有效 `session`。
- 已将成功路径测试改为：先 `session_new` 创建命名空间会话，再写入同命名空间 key，确保结果稳定。
- 已删除旧的“无 session 全局搜索”行为测试，并新增 `memory_fulltext_search` 的无效 session 错误测试。
