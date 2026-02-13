## 1. MCP Schema 更新

- [x] 1.1 更新 `src/mcp/schemas/search.ts` 添加 `sortLinks` 参数定义
  - 添加 `sortLinks` 参数到搜索工具schema
  - 支持boolean类型和字符串类型（"true"/"false"）
  - 设置默认值为 `true`

- [x] 1.2 更新 `src/mcp/schemas/memory.ts` 添加 `sortLinks` 参数定义
  - 添加 `sortLinks` 参数到memoryGet工具schema
  - 支持boolean类型和字符串类型
  - 设置默认值为 `true`

- [x] 1.3 更新MCP工具参数验证逻辑
  - 添加 `sortLinks` 参数解析函数
  - 处理字符串到boolean的转换
  - 添加参数验证错误处理

## 2. MCP 工具实现

- [x] 2.1 更新 `src/mcp/tools/memoryGet.ts`
  - 添加 `sortLinks` 参数处理
  - 调用更新后的查询服务支持排序
  - 确保返回的记忆links正确排序

- [x] 2.2 更新 `src/mcp/tools/memorySearch.ts`
  - 添加 `sortLinks` 参数处理
  - 修改搜索逻辑支持links排序
  - 确保搜索结果中的每个记忆links正确排序

- [x] 2.3 更新 `src/mcp/tools/memoryFulltextSearch.ts`
  - 添加 `sortLinks` 参数处理
  - 修改全文搜索逻辑支持links排序
  - 确保搜索结果中的每个记忆links正确排序

- [x] 2.4 更新MCP工具集成测试
  - 更新现有MCP工具测试
  - 添加 `sortLinks` 参数测试用例
  - 测试排序行为正确性

- [x] 3.1 扩展 `src/service/searchService.ts` 支持MCP调用
  - 确保MCP工具能正确调用排序功能
  - 保持与HTTP API相同的排序逻辑
  - 添加MCP特定的参数处理

- [x] 3.2 更新 `src/service/kvmemory.ts` 支持MCP调用
  - 扩展memory获取服务支持 `sortLinks` 参数
  - 确保MCP工具使用相同的服务层
  - 保持服务层一致性

## 4. 类型定义更新

- [x] 4.1 更新 `src/type.ts` 中的MCP相关类型
  - 添加 `sortLinks` 参数到MCP工具参数类型
  - 更新MCP响应类型定义
  - 确保类型安全

- [x] 4.2 添加MCP工具排序相关类型
  - 定义 `sortLinks` 参数类型
  - 添加排序配置类型
  - 更新工具元数据类型

## 5. 测试实现

- [x] 5.1 单元测试：MCP工具参数验证
  - 创建 `tests/mcp/sortLinks-parameter.test.ts`
  - 测试 `sortLinks` 参数解析正确性
  - 测试参数验证错误处理

- [x] 5.2 单元测试：MCP工具排序功能
  - 创建 `tests/mcp/link-sorting.test.ts`
  - 测试memoryGet工具排序行为
  - 测试搜索工具排序行为
  - 测试排序算法一致性

- [x] 5.3 集成测试：MCP端到端功能
  - 更新 `tests/mcp.search-tools.test.ts`
  - 测试MCP工具完整工作流程
  - 测试与HTTP API行为一致性
  - 测试向后兼容性

- [x] 5.4 性能测试：MCP排序性能
  - 创建 `tests/performance/mcp-sorting.perf.test.ts`
  - 测试MCP工具排序性能
  - 确保排序时间在可接受范围内
  - 测试大规模数据排序性能

## 6. 文档更新

- [x] 6.1 更新 `MCP-README.md` 文档
  - 添加 `sortLinks` 参数说明
  - 提供MCP工具使用示例
  - 更新故障排除章节

- [x] 6.2 更新API文档
  - 更新 `API.md` 中的MCP相关部分
  - 说明HTTP API和MCP工具的一致性
  - 提供跨接口使用指南

- [x] 6.3 更新类型文档
  - 更新TypeScript类型定义文档
  - 添加MCP工具参数说明
  - 提供类型使用示例

## 7. 质量保证

- [x] 7.1 代码审查和重构
  - 审查MCP工具实现代码
  - 确保代码风格一致性
  - 重构重复代码

- [x] 7.2 兼容性测试
  - 测试现有MCP客户端兼容性
  - 确保不指定 `sortLinks` 参数时行为正确
  - 测试参数边界情况

- [x] 7.3 部署验证
  - 验证MCP服务器启动正常
  - 测试MCP工具注册正确
  - 验证生产环境表现