## Why

当前项目在使用SQLite作为存储后端时，存在服务器非正常退出（崩溃、断电、强制终止）导致数据丢失的风险。SQLite默认配置可能无法保证事务的持久性，数据可能仍在操作系统缓存中而未写入磁盘。这个问题在HTTP服务器和MCP服务器双进程模式下尤为严重，需要系统性的崩溃安全配置来确保数据完整性。

## What Changes

1. **SQLite配置优化**：修改数据库连接配置，启用WAL（Write-Ahead Logging）模式，设置适当的同步级别
2. **事务管理增强**：确保所有写操作在显式事务中执行，并正确提交
3. **连接池优化**：改进数据库连接管理，确保连接关闭时的数据持久化
4. **崩溃恢复机制**：添加启动时的WAL文件检查和恢复逻辑
5. **测试覆盖**：添加崩溃场景的集成测试，验证数据持久性

**BREAKING**：无破坏性变更，所有修改都是配置优化和增强

## Capabilities

### New Capabilities
- **sqlite-durability**：定义SQLite数据库的持久性、崩溃安全性和事务完整性要求，确保服务器非正常退出时数据不丢失

### Modified Capabilities
- **memory-storage**：添加SQLite durability configuration requirement，要求系统配置SQLite以实现崩溃安全

## Impact

**受影响代码：**
- `src/libs/kv/db/config.ts` - 数据库连接配置
- `src/libs/kv/db/index.ts` - 数据库连接管理
- `src/libs/kv/db/transaction.ts` - 事务管理
- `src/db.ts` - 数据库初始化
- `src/mcp/index.ts` - MCP服务器数据库连接
- `src/index.ts` - HTTP服务器数据库连接

**受影响API：** 无API变更，仅内部配置优化

**依赖影响：** 无新增依赖

**系统影响：**
- 提高数据持久性，减少数据丢失风险
- 可能轻微影响写入性能（由于同步级别提高）
- 改进系统可靠性，特别是在生产环境部署时