## 1. 创建新的MCP工具

- [x] 1.1 创建新的MCP工具文件：`src/mcp/tools/bulkReadMemory.ts`
- [x] 1.2 定义工具模式：导入现有的MemorySchema，添加bulk_read_memory工具定义
- [x] 1.3 实现工具处理器：调用现有的`bulkReadMemory`服务方法
- [x] 1.4 添加参数验证：确保参数符合规范（depth≤6, breadth≤20, total≤50）
- [x] 1.5 实现响应格式化：支持toon和json输出格式

## 2. 更新MCP服务器注册

- [x] 2.1 导入新的工具处理器到`src/mcp/server.ts`
- [x] 2.2 注册新工具：添加`bulk_read_memory`工具到工具列表
- [x] 2.3 验证工具注册：确保新工具在MCP服务器启动时可用

## 3. 从memory_get工具中移除批量读取功能

- [x] 3.1 更新`src/mcp/tools/memoryGet.ts`：移除bulkRead、depth、breadth、total参数
- [x] 3.2 更新工具模式：从MemorySchema中移除批量读取相关字段
- [x] 3.3 更新处理器逻辑：当接收到批量读取参数时返回错误
- [x] 3.4 更新模式验证：确保只接受单内存读取参数

## 4. 更新测试

- [x] 4.1 创建新的测试文件：`tests/mcp.bulk-read-tools.test.ts`
- [x] 4.2 添加bulk_read_memory工具测试：覆盖所有场景
- [x] 4.3 更新现有测试：`tests/mcp.search-tools.test.ts`移除批量读取相关测试
- [x] 4.4 更新memory_get测试：确保只测试单内存读取功能
- [x] 4.5 运行所有测试：确保23个现有测试全部通过

## 5. 更新文档

- [x] 5.1 更新`MCP-README.md`：
  - 移除`memory_get`工具中的批量读取说明
  - 添加`bulk_read_memory`工具完整说明
  - 更新工具示例和参数说明
- [x] 5.2 更新`docs/BULK_READ_GUIDE.md`：
  - 更新工具使用示例：使用`bulk_read_memory`代替`memory_get` with bulkRead
  - 更新命令行示例和MCP调用示例
- [x] 5.3 更新`API.md`：澄清HTTP API保持不变
- [x] 5.4 更新`CHANGELOG.md`：记录工具分离变更

## 6. 验证和测试

- [x] 6.1 运行完整测试套件：`bun test`
- [x] 6.2 验证工具可用性：通过MCP客户端测试两个工具
- [x] 6.3 验证向后兼容性：HTTP API端点正常工作
- [x] 6.4 验证文档一致性：所有文档引用正确的工具名称和用法
- [x] 6.5 最终检查：确保所有任务完成，变更准备就绪