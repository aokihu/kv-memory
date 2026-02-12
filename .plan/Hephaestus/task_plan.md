# TASK-007-UPDATE-MCP-TESTS 任务计划

## 目标
更新 `tests/mcp.search-tools.test.ts`，使所有相关测试符合 `session` 为必填参数的新约束。

## 执行步骤（严格顺序）
1. **审阅现有测试**
   - 读取目标文件并定位所有 `memory_search` 与 `memory_fulltext_search` 用例。
   - 识别无 `session` 参数和旧描述文本。
2. **修改测试用例**
   - 移除或改造无 `session` 参数的测试。
   - 确保每个有效路径测试都传入由 `session_new` 创建的有效 `session`。
   - 更新用例描述为“session 必填”语义。
3. **补充无效 session 错误测试**
   - 添加/更新用例验证无效 `session` 返回错误。
4. **执行测试验证**
   - 运行 `tests/mcp.search-tools.test.ts` 对应测试命令并确认通过。
5. **收尾记录**
   - 记录修改内容与测试结果。

## 状态
- [complete] 步骤1 审阅现有测试
- [complete] 步骤2 修改测试用例
- [complete] 步骤3 补充无效 session 错误测试
- [complete] 步骤4 执行测试验证
- [complete] 步骤5 收尾记录

## 错误记录
| 错误 | 尝试 | 处理 |
|---|---:|---|
| session-catchup.py 路径不存在 | 1 | 改为手动初始化规划文件并继续 |
